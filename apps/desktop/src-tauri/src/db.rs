//! Local SQLite store for user customizations: character profiles and office
//! layouts. Values are JSON documents validated by the UI's domain layer; this
//! module enforces keys, sizes and schema migrations.

use rusqlite::{params, Connection};
#[cfg(test)]
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

const MAX_DOC_BYTES: usize = 256 * 1024;
const THEMES: [&str; 3] = ["loft", "studio", "midnight"];

/// Ordered migrations; index + 1 is the schema version.
const MIGRATIONS: &[&str] = &[
    "CREATE TABLE agent_profiles (
        key TEXT PRIMARY KEY NOT NULL,
        doc TEXT NOT NULL,
        updated_at INTEGER NOT NULL
     );
     CREATE TABLE office_layouts (
        theme TEXT PRIMARY KEY NOT NULL CHECK (theme IN ('loft', 'studio', 'midnight')),
        doc TEXT NOT NULL,
        updated_at INTEGER NOT NULL
     );",
    // v2: observed session records and their event history (Monitor Mode).
    "CREATE TABLE sessions (
        agent_id TEXT PRIMARY KEY NOT NULL,
        doc TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
     );
     CREATE TABLE events (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        doc TEXT NOT NULL
     );
     CREATE INDEX events_at ON events (at);
     CREATE INDEX sessions_last_seen ON sessions (last_seen);",
];

/// How long observed history is kept.
pub const HISTORY_RETENTION_MS: i64 = 14 * 24 * 60 * 60 * 1000;
/// Upper bound on stored events, oldest dropped first.
pub const MAX_EVENTS: i64 = 50_000;
const MAX_EVENT_DOC_BYTES: usize = 16 * 1024;

#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionIn {
    pub agent_id: String,
    pub doc: String,
}

#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EventIn {
    pub id: String,
    pub agent_id: String,
    pub at: i64,
    pub doc: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEvent {
    pub id: String,
    pub doc: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub sessions: Vec<Row>,
    pub events: Vec<HistoryEvent>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub key: String,
    pub doc: String,
    pub updated_at: i64,
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("db_open_failed: {e}"))?;
        }
        Self::init(Connection::open(path).map_err(|e| format!("db_open_failed: {e}"))?)
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        Self::init(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn init(conn: Connection) -> Result<Self, String> {
        conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
        conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        let mut conn = self.conn.lock().unwrap();
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(|e| e.to_string())?;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            tx.execute_batch(sql).map_err(|e| format!("db_migration_failed: {e}"))?;
            tx.pragma_update(None, "user_version", (i + 1) as i64).map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn schema_version(&self) -> i64 {
        self.conn.lock().unwrap().pragma_query_value(None, "user_version", |r| r.get(0)).unwrap_or(0)
    }

    pub fn profiles(&self) -> Result<Vec<Row>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, doc, updated_at FROM agent_profiles ORDER BY key").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok(Row { key: r.get(0)?, doc: r.get(1)?, updated_at: r.get(2)? }))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub fn put_profile(&self, key: &str, doc: &str, now: i64) -> Result<(), String> {
        validate_key(key)?;
        validate_doc(doc)?;
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO agent_profiles (key, doc, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at",
                params![key, doc, now],
            )
            .map_err(|e| format!("db_write_failed: {e}"))?;
        Ok(())
    }

    pub fn delete_profile(&self, key: &str) -> Result<(), String> {
        self.conn.lock().unwrap().execute("DELETE FROM agent_profiles WHERE key = ?1", params![key]).map_err(|e| format!("db_write_failed: {e}"))?;
        Ok(())
    }

    pub fn layouts(&self) -> Result<Vec<Row>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT theme, doc, updated_at FROM office_layouts ORDER BY theme").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok(Row { key: r.get(0)?, doc: r.get(1)?, updated_at: r.get(2)? }))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    #[cfg(test)]
    pub fn layout(&self, theme: &str) -> Result<Option<Row>, String> {
        self.conn
            .lock()
            .unwrap()
            .query_row("SELECT theme, doc, updated_at FROM office_layouts WHERE theme = ?1", params![theme], |r| {
                Ok(Row { key: r.get(0)?, doc: r.get(1)?, updated_at: r.get(2)? })
            })
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn put_layout(&self, theme: &str, doc: &str, now: i64) -> Result<(), String> {
        validate_theme(theme)?;
        validate_doc(doc)?;
        self.conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO office_layouts (theme, doc, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(theme) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at",
                params![theme, doc, now],
            )
            .map_err(|e| format!("db_write_failed: {e}"))?;
        Ok(())
    }

    pub fn delete_layout(&self, theme: &str) -> Result<(), String> {
        validate_theme(theme)?;
        self.conn.lock().unwrap().execute("DELETE FROM office_layouts WHERE theme = ?1", params![theme]).map_err(|e| format!("db_write_failed: {e}"))?;
        Ok(())
    }
}

impl Db {
    /// Appends events (idempotent by id) and upserts session records in one
    /// transaction, then applies retention.
    pub fn append_history(&self, sessions: &[SessionIn], events: &[EventIn], now: i64) -> Result<(), String> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for s in sessions {
            validate_key(&s.agent_id)?;
            validate_doc(&s.doc)?;
            tx.execute(
                "INSERT INTO sessions (agent_id, doc, first_seen, last_seen) VALUES (?1, ?2, ?3, ?3)
                 ON CONFLICT(agent_id) DO UPDATE SET doc = excluded.doc, last_seen = excluded.last_seen",
                params![s.agent_id, s.doc, now],
            )
            .map_err(|e| format!("db_write_failed: {e}"))?;
        }
        for e in events {
            validate_key(&e.id)?;
            validate_key(&e.agent_id)?;
            if e.doc.len() > MAX_EVENT_DOC_BYTES {
                return Err("document_too_large".into());
            }
            validate_doc(&e.doc)?;
            tx.execute("INSERT OR IGNORE INTO events (id, agent_id, at, doc) VALUES (?1, ?2, ?3, ?4)", params![e.id, e.agent_id, e.at, e.doc])
                .map_err(|e| format!("db_write_failed: {e}"))?;
        }
        let cutoff = now - HISTORY_RETENTION_MS;
        tx.execute("DELETE FROM events WHERE at < ?1", params![cutoff]).map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY at DESC LIMIT -1 OFFSET ?1)",
            params![MAX_EVENTS],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sessions WHERE last_seen < ?1", params![cutoff]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    /// The newest `limit` events since `since` (returned oldest first) and every session record.
    pub fn history(&self, since: i64, limit: i64) -> Result<History, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, doc FROM (SELECT id, doc, at FROM events WHERE at >= ?1 ORDER BY at DESC LIMIT ?2) ORDER BY at ASC")
            .map_err(|e| e.to_string())?;
        let events = stmt
            .query_map(params![since, limit], |r| Ok(HistoryEvent { id: r.get(0)?, doc: r.get(1)? }))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT agent_id, doc, last_seen FROM sessions WHERE last_seen >= ?1 ORDER BY first_seen").map_err(|e| e.to_string())?;
        let sessions = stmt
            .query_map(params![since], |r| Ok(Row { key: r.get(0)?, doc: r.get(1)?, updated_at: r.get(2)? }))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(History { sessions, events })
    }

    pub fn clear_history(&self) -> Result<(), String> {
        self.conn.lock().unwrap().execute_batch("DELETE FROM events; DELETE FROM sessions;").map_err(|e| format!("db_write_failed: {e}"))
    }
}

fn validate_key(key: &str) -> Result<(), String> {
    let ok = !key.is_empty() && key.len() <= 1100 && !key.chars().any(|c| c.is_control());
    ok.then_some(()).ok_or_else(|| "invalid_key".into())
}

fn validate_theme(theme: &str) -> Result<(), String> {
    THEMES.contains(&theme).then_some(()).ok_or_else(|| "invalid_theme".into())
}

fn validate_doc(doc: &str) -> Result<(), String> {
    if doc.len() > MAX_DOC_BYTES {
        return Err("document_too_large".into());
    }
    match serde_json::from_str::<serde_json::Value>(doc) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err("invalid_document".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_to_latest_version() {
        let db = Db::memory();
        assert_eq!(db.schema_version(), MIGRATIONS.len() as i64);
        db.migrate().unwrap(); // idempotent
        assert_eq!(db.schema_version(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn upserts_and_deletes_profiles() {
        let db = Db::memory();
        db.put_profile("project:/Users/a/app", r#"{"name":"Ada"}"#, 1).unwrap();
        db.put_profile("project:/Users/a/app", r#"{"name":"Ada 2"}"#, 2).unwrap();
        let rows = db.profiles().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].doc, r#"{"name":"Ada 2"}"#);
        assert_eq!(rows[0].updated_at, 2);
        db.delete_profile("project:/Users/a/app").unwrap();
        assert!(db.profiles().unwrap().is_empty());
    }

    #[test]
    fn stores_layouts_per_known_theme_only() {
        let db = Db::memory();
        db.put_layout("loft", r#"{"furniture":[]}"#, 5).unwrap();
        assert_eq!(db.layout("loft").unwrap().unwrap().updated_at, 5);
        assert!(db.layout("studio").unwrap().is_none());
        assert_eq!(db.put_layout("castle", "{}", 1).unwrap_err(), "invalid_theme");
        db.delete_layout("loft").unwrap();
        assert!(db.layouts().unwrap().is_empty());
    }

    #[test]
    fn rejects_bad_documents_and_keys() {
        let db = Db::memory();
        assert_eq!(db.put_profile("k", "not json", 1).unwrap_err(), "invalid_document");
        assert_eq!(db.put_profile("k", "[1,2]", 1).unwrap_err(), "invalid_document");
        assert_eq!(db.put_profile("", "{}", 1).unwrap_err(), "invalid_key");
        assert_eq!(db.put_profile("a\nb", "{}", 1).unwrap_err(), "invalid_key");
        let big = format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_DOC_BYTES));
        assert_eq!(db.put_layout("loft", &big, 1).unwrap_err(), "document_too_large");
    }

    fn ev(id: &str, at: i64) -> EventIn {
        EventIn { id: id.into(), agent_id: "ext-1".into(), at, doc: format!(r#"{{"id":"{id}"}}"#) }
    }

    #[test]
    fn appends_history_idempotently_and_reads_newest_first_window() {
        let db = Db::memory();
        let now = 1_000_000_000_000;
        let session = SessionIn { agent_id: "ext-1".into(), doc: r#"{"name":"app"}"#.into() };
        db.append_history(std::slice::from_ref(&session), &[ev("a", now - 3), ev("b", now - 2)], now).unwrap();
        db.append_history(&[session], &[ev("b", now - 2), ev("c", now - 1)], now + 5).unwrap();
        let h = db.history(0, 2).unwrap();
        assert_eq!(h.events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["b", "c"]);
        assert_eq!(h.sessions.len(), 1);
        assert_eq!(h.sessions[0].updated_at, now + 5);
        db.clear_history().unwrap();
        assert!(db.history(0, 10).unwrap().events.is_empty());
    }

    #[test]
    fn applies_retention() {
        let db = Db::memory();
        let now = 2_000_000_000_000;
        db.append_history(&[], &[ev("old", now - HISTORY_RETENTION_MS - 1), ev("new", now)], now).unwrap();
        let ids: Vec<_> = db.history(0, 10).unwrap().events.into_iter().map(|e| e.id).collect();
        assert_eq!(ids, ["new"]);
    }

    #[test]
    fn rejects_bad_history_rows() {
        let db = Db::memory();
        let mut bad = ev("x", 1);
        bad.doc = "nope".into();
        assert_eq!(db.append_history(&[], &[bad], 1).unwrap_err(), "invalid_document");
        let mut big = ev("y", 1);
        big.doc = format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_EVENT_DOC_BYTES));
        assert_eq!(db.append_history(&[], &[big], 1).unwrap_err(), "document_too_large");
    }

    #[test]
    fn persists_across_reopen() {
        let path = std::env::temp_dir().join(format!("av-db-{}.sqlite", crate::config::random_token()));
        Db::open(&path).unwrap().put_profile("demo:ada", r#"{"name":"Ada"}"#, 1).unwrap();
        assert_eq!(Db::open(&path).unwrap().profiles().unwrap().len(), 1);
        let _ = std::fs::remove_file(&path);
    }
}
