FROM ubuntu:16.04

RUN apt-get update && \
  apt-get install -y maven wget ruby ruby-dev rubygems build-essential libxml2-utils rpm git openjdk-8-jdk-headless locales

# Set the locale
RUN sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && \
    locale-gen
ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

# Install FPM (for building packages) and ronn (for making manpages)
RUN gem install --no-ri --no-rdoc fpm:1.9.3 ronn:0.7.3

ARG JENKINS_GID=999
ARG JENKINS_UID=999
RUN groupadd -g $JENKINS_GID jenkins && \
    useradd -m -d /var/lib/jenkins -u $JENKINS_UID -g jenkins jenkins && \
        echo "jenkins ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers
