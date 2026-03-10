FROM ubuntu:20.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
  apt-get install -y openjdk-11-jdk-headless && \
  apt-get install -y wget rake ruby ruby-dev rubygems build-essential libxml2-utils rpm maven git locales

# Set the locale
RUN sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && \
    locale-gen
ENV \
  LANG=en_US.UTF-8 \
  LANGUAGE=en_US:en \
  LC_ALL=en_US.UTF-8

# Install FPM (for building packages) and ronn (for making manpages)
RUN gem install public_suffix -v 5.1.1
RUN gem install dotenv -v 2.8.1
RUN gem install fpm:1.14.1 ronn:0.7.3

RUN git config --global --add safe.directory /workdir

RUN mkdir /workdir
WORKDIR /workdir
