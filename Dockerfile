FROM ubuntu:20.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
  apt-get install -y openjdk-11-jdk-headless && \
  apt-get install -y wget rake ruby ruby-dev rubygems build-essential libxml2-utils rpm git locales

# Due to https://github.com/google/guice/issues/1133, we can not install maven via apt-get
# If apt-get ubuntu does not produce a warning when compiling, we can remove this and use `apt-get install maven` instead
# Instead, following instructions from https://github.com/wolf99/dotfiles/blob/master/how-to-update-maven.md
# Using docker ENV values instead of writing to `/etc/profile.d/maven.sh`
ENV \
  MVN_VERSION=3.8.4 \
  M2_HOME="/opt/maven" \
  MAVEN_HOME="/opt/maven" \
  PATH="/opt/maven/bin:${PATH}"
RUN \
  wget http://www-eu.apache.org/dist/maven/maven-3/${MVN_VERSION}/binaries/apache-maven-${MVN_VERSION}-bin.tar.gz -P /tmp && \
  mkdir /tmp/maven && \
  tar xvf /tmp/apache-maven-${MVN_VERSION}-bin.tar.gz -C /tmp/maven && \
  rm /tmp/apache-maven-${MVN_VERSION}-bin.tar.gz && \
  mkdir ${MAVEN_HOME} && \
  mv -T /tmp/maven/apache-maven-${MVN_VERSION} ${MAVEN_HOME}

# Set the locale
RUN sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && \
    locale-gen
ENV \
  LANG=en_US.UTF-8 \
  LANGUAGE=en_US:en \
  LC_ALL=en_US.UTF-8

# Install FPM (for building packages) and ronn (for making manpages)
RUN gem install fpm:1.14.1 ronn:0.7.3

RUN mkdir /workdir
WORKDIR /workdir
