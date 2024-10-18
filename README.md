# cv-template

## How to use
### Install Jekyll

First, install Homebrew.
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Next, install chruby and ruby-install.
```
brew install chruby ruby-install
```

Next, install ruby use `ruby-install`
```
ruby-install ruby 3.3.5
```

Next, configure your shell to automatically use `chruby`
```
echo "source $(brew --prefix)/opt/chruby/share/chruby/chruby.sh" >> ~/.zshrc
echo "source $(brew --prefix)/opt/chruby/share/chruby/auto.sh" >> ~/.zshrc
echo "chruby ruby-3.3.5" >> ~/.zshrc
```

At Last, install Jekyll.
```
gem install jekyll
```

Please check your ruby that installed by `chruby`.
Check ruby PATH.
```
which ruby
```

Reference:
-  [Jekyll on macOS](https://jekyllrb.com/docs/installation/macos/)

### Build Website 

Do this command, and access `http://127.0.0.1:4000`
```
jekyll serve
```

Reference:
- [Jekyll を使用して GitHub Pages サイトをローカルでテストする](https://docs.github.com/ja/pages/setting-up-a-github-pages-site-with-jekyll/testing-your-github-pages-site-locally-with-jekyll)

### Build tailwindcss

Do this command.
```
npx tailwindcss -i ./tailwind.css -o ./assets/css/tailwind.css
```
