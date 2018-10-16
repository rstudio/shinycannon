VERSION=$(shell xmllint --xpath '/*[local-name()="project"]/*[local-name()="version"]/text()' pom.xml)
GIT_SHA=$(shell git rev-parse --short HEAD)

VERSION_FILE=shinycannon-version.txt

MAVEN_UBERJAR=target/shinycannon-$(VERSION)-jar-with-dependencies.jar

PREFIX=package/usr/local
BINDIR=$(PREFIX)/bin
MANDIR=$(PREFIX)/share/man/man1

FPM_ARGS=--iteration $(GIT_SHA) -f -s dir -n shinycannon -v $(VERSION) -C package .

RPM_FILE=shinycannon-$(VERSION)-$(GIT_SHA).x86_64.rpm
DEB_FILE=shinycannon_$(VERSION)-$(GIT_SHA)_amd64.deb
JAR_FILE=shinycannon-$(VERSION)-$(GIT_SHA).jar
BIN_FILE=shinycannon-$(VERSION)-$(GIT_SHA).sh

BUCKET_NAME=rstudio-shinycannon-build

.PHONY: packages RELEASE.txt

packages: $(RPM_FILE) $(DEB_FILE) $(JAR_FILE) $(BIN_FILE)

# This is the uberjar produced and named by Maven. It's renamed to $(JAR_FILE),
# which is the uberjar we upload to S3 and document using. The only difference
# between the two is that the $(JAR_FILE) file name contains $(GIT_SHA).
# $(VERSION_FILE) is embededed in the jar to provide the version at runtime.
$(MAVEN_UBERJAR):
	mvn package
	echo -n $(VERSION)-$(GIT_SHA) > $(VERSION_FILE)
	jar uf $(MAVEN_UBERJAR) $(VERSION_FILE)
	rm -f $(VERSION_FILE)

$(BINDIR)/shinycannon: head.sh $(MAVEN_UBERJAR)
	mkdir -p $(dir $@)
	cat $^ > $@
	chmod 755 $@

$(MANDIR)/shinycannon.1: shinycannon.1.ronn
	mkdir -p $(dir $@)
	cat $< |ronn -r --manual="SHINYCANNON MANUAL" --pipe > $@

$(RPM_FILE): $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	fpm -t rpm -d 'java >= 1.7.0' $(FPM_ARGS)

# Install with 'apt update && apt install ./shinycannon_*.deb'
$(DEB_FILE): $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	fpm -t deb -d default-jre-headless $(FPM_ARGS)

$(JAR_FILE): $(MAVEN_UBERJAR)
	cp $^ $@

$(BIN_FILE): $(BINDIR)/shinycannon
	cp $^ $@

RELEASE.txt:
	echo $(shell date +"%Y-%m-%d-%T")_$(VERSION)-$(GIT_SHA) > $@

RELEASE_URLS.txt: RELEASE.txt
	rm -f $@
	echo https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/deb/$(DEB_FILE) >> $@
	echo https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/rpm/$(RPM_FILE) >> $@
	echo https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/jar/$(JAR_FILE) >> $@
	echo https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/bin/$(BIN_FILE) >> $@

clean:
	rm -rf package target
	rm -f $(VERSION_FILE) $(RPM_FILE) $(DEB_FILE) $(JAR_FILE) $(BIN_FILE)

print-%  : ; @echo $* = $($*)
