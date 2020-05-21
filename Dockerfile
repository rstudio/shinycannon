FROM ubuntu:20.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
  apt-get install -y openjdk-8-jdk-headless && \
  apt-get install -y maven wget rake ruby ruby-dev rubygems build-essential libxml2-utils rpm git locales

# Set the locale
RUN sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && \
    locale-gen
ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

# Install FPM (for building packages) and ronn (for making manpages)
RUN gem install fpm:1.11.0 ronn:0.7.3

COPY build.sh /build.sh

ENTRYPOINT ["/build.sh"]
