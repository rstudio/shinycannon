VERSION=$(shell xmllint --xpath '/*[local-name()="project"]/*[local-name()="version"]/text()' pom.xml)
GIT_SHA=$(shell git rev-parse --short HEAD)

UBERJAR=target/shinycannon-$(VERSION)-jar-with-dependencies.jar

PREFIX=package/usr/local
BINDIR=$(PREFIX)/bin
MANDIR=$(PREFIX)/share/man/man1

FPM_ARGS=--iteration $(GIT_SHA) -f -s dir -n shinycannon -v $(VERSION) -C package .

RPM_FILE=shinycannon-$(VERSION)-$(GIT_SHA).x86_64.rpm
DEB_FILE=shinycannon_$(VERSION)-$(GIT_SHA)_amd64.deb

BUCKET_NAME=rstudio-shinycannon-build

.PHONY: packages RELEASE.txt

packages: $(RPM_FILE) $(DEB_FILE)

$(UBERJAR):
	mvn package

$(BINDIR)/shinycannon: head.sh $(UBERJAR)
	mkdir -p $(dir $@)
	cat $^ > $@
	chmod 755 $@

$(MANDIR)/shinycannon.1: shinycannon.1.ronn
	mkdir -p $(dir $@)
	cat $< |ronn -r --manual="SHINYCANNON MANUAL" --pipe > $@

$(RPM_FILE): $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	fpm -t rpm -d java $(FPM_ARGS)

# Install with 'apt update && apt install ./shinycannon_*.deb'
$(DEB_FILE): $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	fpm -t deb -d default-jre-headless $(FPM_ARGS)

RELEASE.txt:
	echo $(shell date +"%Y-%m-%d-%T")_$(VERSION)-$(GIT_SHA) > $@

RELEASE_URLS.txt: RELEASE.txt
	rm -f $@
	echo https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/deb/$(DEB_FILE) >> $@
	echo https://s3.amazonaws.com/rstudio-shinycannon-build/$(shell cat $<)/rpm/$(RPM_FILE) >> $@

clean:
	rm -rf package target
	rm -f *.rpm *.deb
