# choimake.github.io
公開用の職務経歴書

## How to use
### Install tools
Ruby and Node.js versions are pinned in `mise.toml`. Install [mise](https://mise.jdx.dev/), then run:
```
mise install
```

### Install dependencies
```
npm ci
bundle install
```

### Build Website
Build Tailwind CSS and serve the site, then access `http://127.0.0.1:4000`
```
mise run serve
```

To build only Tailwind CSS:
```
mise run css
```

Reference:
- [Jekyll を使用して GitHub Pages サイトをローカルでテストする](https://docs.github.com/ja/pages/setting-up-a-github-pages-site-with-jekyll/testing-your-github-pages-site-locally-with-jekyll)

## How to Development

First, run `mise run serve`

Second, edit code

Third, build and validate the generated HTML.
```
mise run validate
```

### Deploy
Pushing to `main` builds the site with GitHub Actions and deploys it to GitHub Pages (`.github/workflows/pages.yaml`). The build uses the Jekyll version in `Gemfile.lock`.

### Secret scan
Scan secrets with gitleaks, including git history. GitHub Actions runs the same task on pull requests and `main`.
```
mise run gitleaks
```

To scan only staged changes before committing:
```
mise run gitleaks:protect
```

Settings are in `.gitleaks.toml`. It uses the default rules. Add an allowlist to exclude false positives.

### Dependency updates
GitHub Actions runs `deps-propose` every Monday. It leaves outdated dependencies as issues. Read the issue, then open a PR if needed.

It checks:
- npm packages
- GitHub Actions
- Ruby gems, including indirect ones, and Bundler itself. Versions blocked by other gems' requirements are skipped
- Tools in `mise.toml`. Node.js is compared with the latest LTS
- Libraries loaded from cdnjs in `docs/`

To list the candidates locally without creating issues:
```
mise run deps:propose
```
