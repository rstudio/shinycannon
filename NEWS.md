# shinycannon (development)

* Updated dependencies: (#65)
  * `log4j`: `2.16.0` (@hekhuisk)
  * `maven`: `3.8.4`
  * `gson`: `2.8.9`
  * `httpclient`: `4.5.13`
  * `maven-assembly-plugin`: `3.3.0`
  * `fpm`: `1.14.1`
* Updated to use JDK 11 (from JDK 8) (#65)
  * Set a `Multi-Release` flag to true
  * Changed `kotlin-stdlib-jdk7` -> `kotlin-stdlib`
  * Set JVM target to 1.8 (Java 8)

# shinycannon 1.1.1

* Increased the `receiveQueue` limit from 5 to 50 to avoid queue limit errors when non-determinist custom messages are being sent out of order (#63)

# shinycannon 1.1.0

* Allow adding headers, including RStudio Connect API Key (#49, #56)
* Fixed an SSP issue when using `reconnect off` configuration would produce errors that were swallowed. (#58)

# shinycannon 1.0.0

## Bug Fixes

* Fixed an error that would show up in long-running sessions and was triggered
  by __extendsession__ POST requests (#41)

## Enhancements

* App detection is now tolerant of invalid HTML/XML (#42)
* Improved help output (#24, #27)
