FROM ubuntu:16.04

# Shinycannon build deps
RUN apt-get update && \
  apt-get install -y maven wget ruby ruby-dev rubygems build-essential libxml2-utils rpm git curl

# Install FPM (for building packages) and ronn (for making manpages)
RUN gem install --no-ri --no-rdoc fpm:1.9.3 ronn:0.7.3

# Install add-apt-repository
RUN apt-get install -y software-properties-common python-software-properties apt-transport-https

# Install R & shiny stuff
RUN apt-key adv --keyserver keyserver.ubuntu.com --recv-keys E298A3A825C0D65DFD57CBB651716619E084DAB9 && \
  add-apt-repository 'deb [arch=amd64,i386] https://cran.rstudio.com/bin/linux/ubuntu xenial/' && \
  apt-get update && \
  apt-get install -y r-base libcurl4-openssl-dev libssl-dev libxml2-dev && \
  R -e 'install.packages("devtools")' && \
  R -e 'library(devtools);devtools::install_version("shiny", "1.0.5")' && \
  R -e 'library(devtools);devtools::install_version("rmarkdown", "1.10")'


# Install Chrome
RUN curl -O https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
  dpkg -i google-chrome-stable_current_amd64.deb; \
  apt-get -fy install

# Node
RUN curl -sL https://deb.nodesource.com/setup_8.x | bash - && \
  apt-get install -y nodejs && \
  npm i -g --unsafe-perm=true --allow-root selenium-webdriver@3.6.0 chromedriver@2.40.0

ARG JENKINS_GID=999
ARG JENKINS_UID=999
RUN groupadd -g $JENKINS_GID jenkins && \
    useradd -m -d /var/lib/jenkins -u $JENKINS_UID -g jenkins jenkins && \
        echo "jenkins ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers
