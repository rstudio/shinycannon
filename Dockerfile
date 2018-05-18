FROM ubuntu:16.04

RUN apt-get update && \
  apt-get install -y maven wget zlib1g-dev ruby ruby-dev rubygems build-essential libxml2-utils rpm git

# Download and install Graal (for creating standalone binaries)
RUN mkdir -p /opt/graal
RUN mkdir -p /opt/graal \
  && wget -O - https://github.com/oracle/graal/releases/download/vm-1.0.0-rc1/graalvm-ce-1.0.0-rc1-linux-amd64.tar.gz \
    | tar xvz -C /opt/graal --strip-components=1

# Install FPM (for building packages)
RUN gem install --no-ri --no-rdoc fpm:1.9.3 ronn:0.7.3

ARG JENKINS_GID=999
ARG JENKINS_UID=999
RUN groupadd -g $JENKINS_GID jenkins && \
    useradd -m -d /var/lib/jenkins -u $JENKINS_UID -g jenkins jenkins && \
        echo "jenkins ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers
