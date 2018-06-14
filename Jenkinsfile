#!groovy

properties([
    disableConcurrentBuilds(),
    buildDiscarder(logRotator(artifactDaysToKeepStr: '',
                              artifactNumToKeepStr: '',
                              daysToKeepStr: '',
                              numToKeepStr: '100')),
    parameters([string(name: 'SLACK_CHANNEL', defaultValue: '#shinyloadtest', description: 'Slack channel to publish build message.')])
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
        container = pullBuildPush(image_name: 'jenkins/shinycannon', dockerfile: 'Dockerfile', image_tag: 'ubuntu-16.04-x86_64', build_arg_jenkins_uid: 'JENKINS_UID', build_arg_jenkins_gid: 'JENKINS_GID')
      }
      container.inside() {
        stage('build') {
          sh """
          make packages
          make RELEASE.txt RELEASE_URLS.txt
          """
        }
	stage('integration test') {
          sh """
          ./integration_test.sh
          """
	}
      }
      stage('s3 upload') {
      	sh """
      	aws s3 cp *.rpm s3://rstudio-shinycannon-build/\$(cat RELEASE.txt)/rpm/
      	aws s3 cp *.deb s3://rstudio-shinycannon-build/\$(cat RELEASE.txt)/deb/
      	aws s3 cp RELEASE_URLS.txt s3://rstudio-shinycannon-build/
      	"""
      }
    }
    // sendNotifications slack_channel: params.SLACK_CHANNEL
  }
} catch (err) {
   sendNotifications slack_channel: params.SLACK_CHANNEL, result: 'FAILURE'
   error("shinycannon player build failed: ${err}")
}
