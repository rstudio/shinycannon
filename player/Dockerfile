FROM ubuntu:16.04

RUN apt-get update && apt-get install -y maven

ARG JENKINS_GID=999
ARG JENKINS_UID=999
RUN groupadd -g $JENKINS_GID jenkins && \
    useradd -m -d /var/lib/jenkins -u $JENKINS_UID -g jenkins jenkins && \
        echo "jenkins ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers
