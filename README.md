# choimake.github.io
公開用の職務経歴書

## How to use
### Install Homebrew
install Homebrew.
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
### Install Modules
Do this command
```
brew install node
```

Next, install node_modules
```
npm install
```
### Build tailwindcss

Do this command.
```
npx @tailwindcss/cli -i ./tailwind.css -o ./docs/assets/css/tailwind.css
```
### Install Jekyll

First, install chruby and ruby-install.
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


## How to Development

First, do jekyll serve

Second, edit code

Third, do html validator like this.
```
npx html-validator _site
```