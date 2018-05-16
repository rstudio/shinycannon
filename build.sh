#!/usr/bin/env bash

set -xe

VERSION=$(xmllint --xpath '/*[local-name()="project"]/*[local-name()="version"]/text()' pom.xml)

mvn package

UBERJAR="target/shinycannon-${VERSION}-jar-with-dependencies.jar"

/opt/graal/bin/native-image -H:+ReportUnsupportedElementsAtRuntime -jar "${UBERJAR}"

mv "shinycannon-${VERSION}-jar-with-dependencies" target/shinycannon
