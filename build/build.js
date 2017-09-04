const pkg = require("pkg");

async function build() {
  console.log("Starting build of macos 64 and linux 64 executables.");
  console.log("Using node 8");
  try {
    var c = await pkg.exec([
      "lib/main.js",
      "--targets",
      "node8-macos-x64,node8-linux-x64",
      "--output-path",
      "build"
    ]);
  } catch (err) {
    console.log(err);
  }
}

build().then(() => {
  console.log("Done Building Executables");
});
