# yoheinakamura.dev

Eleventy. No JS on the published pages, no webfonts, no CSS toolchain.

```sh
npm install
npm run dev     # http://localhost:8080, live reload
npm run build   # -> _site/
```

Pushing to `main` builds and deploys through `.github/workflows/deploy.yml`.

## Adding a post

Drop a Markdown file in `src/posts/`. The filename is the URL.

```
src/posts/some-post.md   ->   https://yoheinakamura.dev/some-post/
```

```yaml
---
title: "The post title, written as a sentence"
dek: One sentence. Used as the index blurb, the meta description, and the og:description.
date: 2026-01-01
repo: https://github.com/nanonanomachine/some-repo   # optional
draft: true                                          # optional, see below
---
```

`repo` adds a pointer to the harness at the end of the post. Leave it out and
nothing renders.

**Never change a slug after publishing.** Nothing redirects, and the links in
other people's comments and bookmarks are the whole point.

### Drafts

`draft: true` in frontmatter removes a post completely — no page written, and
nothing in the index, the feed, or the sitemap. Delete the line to publish.

Keep drafts in `src/posts/` rather than off to one side: `npm run dev` still
renders them at their real URL, so what you proofread is what ships.

### Search engines

`indexable` in `src/_data/site.json` gates the whole site.

| `indexable` | every page | `/robots.txt` |
|---|---|---|
| `false` | `<meta name="robots" content="noindex, nofollow">` | `Disallow: /` |
| `true` | nothing | `Allow: /` + sitemap |

It ships `false` so the infrastructure can go live — DNS, certificate, deploy
pipeline — before there is anything worth finding. **Flip it to `true` on
launch day.** An unlinked domain gets no traffic regardless; this is the belt
to that suspenders.

After adding a post, regenerate the share cards:

```sh
npx playwright@latest install chromium   # once
node scripts/og.mjs                      # writes src/static/og/<slug>.png
```

It reads frontmatter straight from `src/posts/`, so there is nothing to
configure. Commit the PNGs — the deploy is a plain `npm ci && eleventy` and
never launches a browser. Each post picks up `/og/<slug>.png` automatically;
set `image:` in frontmatter only to override.

## Writing conventions

Tables are the element this site is designed around. The first column is
treated as a label — it is set in the body serif — and every other column is
set in tabular mono, so numbers line up across rows.

Right-align numeric columns with Markdown's own alignment syntax:

```markdown
| condition       | Chrome | Firefox |
| --------------- | -----: | ------: |
| normal tab      |    123 |     999 |
| AudioWorklet    |    124 |     999 |
```

Code blocks and tables break out wider than the reading column automatically.
Everything else stays inside it.

There is no syntax highlighting. Adding it means a Prism dependency and a
second stylesheet; the code in these posts is short enough that it has not been
worth it.

## Layout

```
src/
├── _data/site.json        title, bio, contact links — edit here, not in templates
├── _includes/
│   ├── base.njk           <head>, masthead, footer
│   └── post.njk           article shell
├── index.njk              bio + post ledger
├── feed.njk               Atom, hand-rolled, no plugin
├── posts/
│   ├── posts.11tydata.js  shared frontmatter: layout + permalink
│   └── *.md               one file per post
└── static/                copied to the site root as-is
    ├── CNAME              yoheinakamura.dev
    └── style.css
```

## Domain

`CNAME` in `src/static/` is what points the site at `yoheinakamura.dev`. It
must survive every build — that is why it lives in the passthrough directory
rather than being set in the GitHub UI, which rewrites it into the repo root
and loses it on the next deploy.
