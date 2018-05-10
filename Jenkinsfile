#!groovy

properties([
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(artifactDaysToKeepStr: '',
                              artifactNumToKeepStr: '',
                              daysToKeepStr: '',
                              numToKeepStr: '100')),
    parameters([string(name: 'SLACK_CHANNEL', defaultValue: '#shiny', description: 'Slack channel to publish build message.')])
])

def prepareWorkspace(){
  step([$class: 'WsCleanup'])
  checkout scm
  sh 'git reset --hard && git clean -ffdx'
}

try {
  timestamps {
    node('docker') {
      stage('prepare ws/container') {
        prepareWorkspace()
        container = pullBuildPush(image_name: 'jenkins/shinycannon-player', dockerfile: 'Dockerfile', image_tag: 'ubuntu-16.04-x86_64', build_arg_jenkins_uid: 'JENKINS_UID', build_arg_jenkins_gid: 'JENKINS_GID')
      }
      container.inside() {
        stage('mvn package') {
          sh """
          cd player
          mvn package
          """
        }
      }
      stage('s3 upload') {
        sh """
        aws s3 cp target/player-1.0-jar-with-dependencies.jar s3://rstudio-shiny-server-pro-build/shinycannon-player/player-\$(date +"%Y-%m-%d")-\$(git rev-parse --short=7 --verify HEAD).jar
        """
      }
    }
    sendNotifications slack_channel: params.SLACK_CHANNEL
  }
} catch (err) {
   sendNotifications slack_channel: params.SLACK_CHANNEL, result: 'FAILURE'
   error("shinycannon player build failed: ${err}")
}
