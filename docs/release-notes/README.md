# Release notes

One file per release, named after the tag: `vX.Y.Z.md`. The release workflow puts it in the GitHub release and in `latest.json`, and the in-app update dialog shows the part for the user's language (English when a language is missing). Each language starts with a comment line, which GitHub doesn't display:

```markdown
<!-- en -->
- New: …
- Fixed: …

<!-- zh-TW -->
- 新增：…
- 修正：…
```

Keep it short and in plain text (the dialog shows it as text, without Markdown formatting). Your character, coins and offices are always kept, so there's no need to say so.
