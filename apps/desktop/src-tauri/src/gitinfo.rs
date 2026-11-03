//! Where a working directory sits in git: repository identity (the shared git
//! dir, identical for all worktrees), working-tree root, branch, and whether
//! it is a linked worktree. Read-only git commands, argument arrays, timeout.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub repo: String,
    pub toplevel: String,
    pub branch: String,
    pub is_worktree: bool,
}

fn run(cwd: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(cwd).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => {
                let mut out = String::new();
                use std::io::Read;
                child.stdout.take()?.read_to_string(&mut out).ok()?;
                return Some(out);
            }
            Ok(Some(_)) => return None,
            Ok(None) if Instant::now() > deadline => {
                let _ = child.kill();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => return None,
        }
    }
}

fn canonical(p: &Path) -> PathBuf {
    let c = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    // Windows canonical paths carry a `\\?\` prefix; keep display paths plain.
    PathBuf::from(c.to_string_lossy().trim_start_matches(r"\\?\").to_string())
}

pub fn parse(cwd: &Path, where_out: &str, branch_out: &str) -> Option<GitInfo> {
    let mut lines = where_out.lines().map(str::trim);
    let toplevel = PathBuf::from(lines.next().filter(|l| !l.is_empty())?);
    let common = PathBuf::from(lines.next().filter(|l| !l.is_empty())?);
    let common = if common.is_absolute() { common } else { cwd.join(common) };
    let repo = canonical(&common);
    let top = canonical(&toplevel);
    let branch = branch_out.trim();
    Some(GitInfo {
        is_worktree: repo != canonical(&top.join(".git")),
        repo: repo.to_string_lossy().into(),
        toplevel: top.to_string_lossy().into(),
        branch: if branch.is_empty() { "(detached)".into() } else { branch.into() },
    })
}

/// `None` when `cwd` isn't absolute/existing, isn't in a repository, or git is missing.
pub fn git_info(cwd: &str) -> Option<GitInfo> {
    let cwd = Path::new(cwd);
    if !cwd.is_absolute() || !cwd.is_dir() {
        return None;
    }
    let where_out = run(cwd, &["rev-parse", "--show-toplevel", "--git-common-dir"])?;
    // `branch --show-current` also works before the first commit, unlike `rev-parse HEAD`.
    let branch = run(cwd, &["branch", "--show-current"]).unwrap_or_default();
    parse(cwd, &where_out, &branch)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(cwd: &Path, args: &[&str]) {
        assert!(Command::new("git").arg("-C").arg(cwd).args(args).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap().success());
    }

    #[test]
    fn parses_output() {
        let i = parse(Path::new("/r"), "/r\n.git\n", "main\n").unwrap();
        assert_eq!((i.branch.as_str(), i.is_worktree), ("main", false));
        assert_eq!(parse(Path::new("/r/wt"), "/r/wt\n/r/.git\n", "").unwrap().branch, "(detached)");
        assert!(parse(Path::new("/x"), "", "").is_none());
    }

    #[test]
    fn identifies_worktrees_of_one_repository() {
        let root = canonical(&std::env::temp_dir()).join(format!("av-git-{}", crate::config::random_token()));
        let main = root.join("main");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        std::fs::write(main.join("a.txt"), "a").unwrap();
        git(&main, &["add", "."]);
        git(&main, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
        git(&main, &["worktree", "add", "-q", "-b", "feature-x", root.join("wt").to_str().unwrap()]);
        let a = git_info(main.to_str().unwrap()).unwrap();
        let b = git_info(root.join("wt").to_str().unwrap()).unwrap();
        assert_eq!((a.branch.as_str(), a.is_worktree), ("main", false));
        assert_eq!((b.branch.as_str(), b.is_worktree), ("feature-x", true));
        assert_eq!(a.repo, b.repo);
        assert!(git_info(root.to_str().unwrap()).is_none());
        assert!(git_info("relative/path").is_none());
        let fresh = root.join("fresh");
        std::fs::create_dir_all(&fresh).unwrap();
        git(&fresh, &["init", "-q", "-b", "trunk"]);
        assert_eq!(git_info(fresh.to_str().unwrap()).unwrap().branch, "trunk");
    }
}
