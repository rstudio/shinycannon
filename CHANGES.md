# Changelog

## master

### Bug Fixes

* Fixed an error that would show up in long-running sessions and was triggered
  by __extendsession__ POST requests ([#41][41])

### Enhancements

* Allow adding headers, including RStudio Connect API Key ([#49][49])
* App detection is now tolerant of invalid HTML/XML ([#42][42])
* Improved help output ([#24][24], [#27][27])

[24]: https://github.com/rstudio/shinycannon/pull/24
[27]: https://github.com/rstudio/shinycannon/pull/27
[41]: https://github.com/rstudio/shinycannon/pull/41
[42]: https://github.com/rstudio/shinycannon/pull/42
[49]: https://github.com/rstudio/shinycannon/pull/49
