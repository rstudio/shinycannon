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
