# shinycannon

A load generation tool for [Shiny](https://shiny.rstudio.com/) applications. Part of https://rstudio.github.io/shinyloadtest

## Installation

For installation instructions, please see [the shinyloadtest documentation](https://rstudio.github.io/shinyloadtest).

## Development

shinycannon is written in [Kotlin][kotlin], a [JVM][jvm] language. Consequently,
shinycannon is able to run on whatever platforms JVM is.

However, to ease installation on various platforms, we produce package installer
files using [fpm][fpm] in addition to a .jar file.

### Building the .jar

1. Install the JDK: https://openjdk.java.net/
1. Install Maven: https://maven.apache.org/

> Your platform's package installer, such as homebrew/apt/rpm/etc, is probably
> the best way to install the JDK and Maven on your machine.

Next, you can build a .jar with:

```
mvn package
```

A file, `target/shinycannon-1.0.0-jar-with-dependencies.jar` will be created.

You can run it with something like:

```
java -jar target/shinycannon-1.0.0-jar-with-dependencies.jar recording.log
http://example.com/your/app

```

### Building Installers

Building packages for all platforms is best accomplished with [Docker][docker].
We use the `Dockerfile` included in this repository.

First, build an image with a command like the following:

```
docker build -t shinycannon-build .
```

Then, to build the .jar and all packages (rpm/deb/sh):

```
sudo docker run -it --rm -v $PWD:/root -w /root sc-build make packages
```

> Note: you may or may not need `sudo`, depending on how you installed Docker.

## License

MIT

[kotlin]: https://kotlinlang.org/
[jvm]: https://en.wikipedia.org/wiki/Java_virtual_machine
[fpm]: https://github.com/jordansissel/fpm
[docker]: https://github.com/jordansissel/fpm
