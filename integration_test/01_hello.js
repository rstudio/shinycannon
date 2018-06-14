const fs = require('fs');
const webdriver = require('selenium-webdriver');
const chromedriver = require('chromedriver');

const chromeCapabilities = webdriver.Capabilities.chrome();
chromeCapabilities.set('chromeOptions', {
  args: [
    '--headless',
    '--no-sandbox',
    '--window-size=1200x800'
  ]
});

function screenshot(driver) {
  return driver.takeScreenshot()
    .then(base64png => {
      fs.writeFileSync(
        `screenshot-${(new Date).getTime()}.png`,
         new Buffer(base64png, 'base64')
      );
    }).then(() => {
      return driver;
    });
}

new webdriver.Builder()
  .forBrowser('chrome')
  .withCapabilities(chromeCapabilities)
  .build()
  .then(driver => {
    driver.manage().deleteAllCookies();
    return driver;
  })
  .then(driver => {
    driver.get('http://localhost:8600');
    return driver;
  })
  .then(driver => {
    return driver
      .wait(webdriver.until.titleIs("Hello Shiny!"), 5000)
      .then(() => driver);
  })
  //.then(screenshot)
  .then(driver => {
    driver.quit();
  });


