# shinycannon

A load generation tool for [Shiny](https://shiny.rstudio.com/) applications. Part of https://rstudio.github.io/shinyloadtest

## Installation

For installation instructions, please see [the shinyloadtest documentation](https://rstudio.github.io/shinyloadtest).

## Development

shinycannon is written in [Kotlin][kotlin], a [JVM][jvm] language. Consequently,
shinycannon is able to run on whatever platforms JVM is.

However, to ease installation on various platforms, we produce package installer
files using [fpm][fpm] in addition to a .jar file.

### Building

Building packages for all platforms is best accomplished with [Docker][docker].
We'll use the `Dockerfile` included in this repository.

First, build the Docker image with a command like the following:

```
docker build -t shinycannon-build .
```

#### Executable

To build the `.jar` file:

```
sudo docker run -it --rm -v $PWD:/root -w /root shinycannon-build make maven
```
> Note: you may or may not need `sudo`, depending on how you installed Docker.

A file, `target/shinycannon-1.1.0-jar-with-dependencies.jar` will be created.


#### Installers

To build the `.jar` file and all packages (rpm/deb/sh):

```
sudo docker run -it --rm -v $PWD:/root -w /root shinycannon-build make clean_out packages
```

> Note: you may or may not need `sudo`, depending on how you installed Docker.

All installer files will be stored in the `./out` folder

### Running

You can run `shinycannon` with something like:

```bash
java -jar \
  ./target/shinycannon-1.1.0-jar-with-dependencies.jar \
  recording.log \
  http://example.com/your/app
```

If you are running against an app on RStudio Connect, an [RStudio Connect API Key](https://docs.rstudio.com/connect/user/api-keys/) is the easiest way to handle authentication. You can set this value using options `-K` or `--connect-api-key`  Set the environment variable `SHINYCANNON_CONNECT_API_KEY` with your Connect API Key.

> Note: that if the recording was done with an RStudio Connect API key, playback **MUST** be done with an RStudio Connect API key.  Similarly, if a recording does **NOT** use an API key, playback must **NOT** use an API key.


## Releasing

In the past, release installers were built privately on internal
RStudio infrastructure. Release artifacts were deployed to S3. Now,
release artifacts are built with a GitHub Actions workflow and
uploaded as GitHub release assets.

Before releasing, first update `pom.xml` with the desired
version. Then, to create a release and build corresponding release
artifacts, create and push a tag prefixed with `v` such as
`v1.2.3`. On push, the shinycannon `.jar` and a set of
platform-specific installers will be created and uploaded.

Releases are available under the "Releases" tab of the project GitHub
page.

After release artifacts are created, you should update the
shinyloadtest documentation to point to the correct URLs.

## License

MIT

[kotlin]: https://kotlinlang.org/
[jvm]: https://en.wikipedia.org/wiki/Java_virtual_machine
[fpm]: https://github.com/jordansissel/fpm
[docker]: https://github.com/jordansissel/fpm
