VERSION=$(shell xmllint --xpath '/*[local-name()="project"]/*[local-name()="version"]/text()' pom.xml)
GIT_SHA=$(shell git rev-parse --short HEAD)

VERSION_FILE=shinycannon-version.txt

MAVEN_UBERJAR=target/shinycannon-$(VERSION)-jar-with-dependencies.jar

PREFIX=package/usr/local
BINDIR=$(PREFIX)/bin
MANDIR=$(PREFIX)/share/man/man1

FPM_ARGS=--iteration $(GIT_SHA) -f -s dir -n shinycannon -v $(VERSION) -C package .

RPM_RH_FILE=$(OUT_DIR)/shinycannon-$(VERSION)-$(GIT_SHA).x86_64.rpm
RPM_SUSE_FILE=$(OUT_DIR)/shinycannon-$(VERSION)-suse-$(GIT_SHA).x86_64.rpm
DEB_FILE=$(OUT_DIR)/shinycannon_$(VERSION)-$(GIT_SHA)_amd64.deb
JAR_FILE=$(OUT_DIR)/shinycannon-$(VERSION)-$(GIT_SHA).jar
BIN_FILE=$(OUT_DIR)/shinycannon-$(VERSION)-$(GIT_SHA).sh

BUCKET_NAME=rstudio-shinycannon-build

.PHONY: all packages RELEASE.txt

all: packages

packages: $(RPM_RH_FILE) $(RPM_SUSE_FILE) $(DEB_FILE) $(JAR_FILE) $(BIN_FILE)

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

$(RPM_RH_FILE): $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	mkdir -p $(dir $@)
	fpm -t rpm -d 'java >= 1:1.7.0' -p $(RPM_RH_FILE) $(FPM_ARGS)

$(RPM_SUSE_FILE): $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	mkdir -p $(dir $@)
	fpm -t rpm -d 'java-headless >= 1.7.0' -p $(RPM_SUSE_FILE) $(FPM_ARGS)

# Install with 'apt update && apt install ./shinycannon_*.deb'
$(DEB_FILE): $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	mkdir -p $(dir $@)
	fpm -t deb -d default-jre-headless -p $(DEB_FILE) $(FPM_ARGS)

$(JAR_FILE): $(MAVEN_UBERJAR)
	mkdir -p $(dir $@)
	cp $^ $@

$(BIN_FILE): $(BINDIR)/shinycannon
	mkdir -p $(dir $@)
	cp $^ $@

$(OUT_DIR)/RELEASE.txt:
	mkdir -p $(dir $@)
	echo $(shell date +"%Y-%m-%d-%T")_$(VERSION)-$(GIT_SHA) > $@

# RELEASE_URLS.csv: RELEASE.txt
# 	mkdir -p $(dir $@)
# 	rm -f $@
# 	echo version,sha,platform,file,url >> $@
# 	echo $(VERSION),$(GIT_SHA),deb,$(DEB_FILE),https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/deb/$(DEB_FILE) >> $@
# 	echo $(VERSION),$(GIT_SHA),rpm_suse,$(RPM_SUSE_FILE),https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/rpm/$(RPM_SUSE_FILE) >> $@
# 	echo $(VERSION),$(GIT_SHA),rpm_rh,$(RPM_RH_FILE),https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/rpm/$(RPM_RH_FILE) >> $@
# 	echo $(VERSION),$(GIT_SHA),jar,$(JAR_FILE),https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/jar/$(JAR_FILE) >> $@
# 	echo $(VERSION),$(GIT_SHA),sh,$(BIN_FILE),https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/bin/$(BIN_FILE) >> $@

clean:
	rm -rf package target
	rm -f $(VERSION_FILE)
	rm -rf $(OUT_DIR)

print-%  : ; @echo $* = $($*)
