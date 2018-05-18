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

.PHONY: packages publish clean

packages: $(RPM_FILE) $(DEB_FILE)

$(UBERJAR):
	mvn package

$(BINDIR)/shinycannon: $(UBERJAR)
	mkdir -p $(dir $@)
	/opt/graal/bin/native-image -H:+ReportUnsupportedElementsAtRuntime -jar $<
	mv shinycannon-$(VERSION)-jar-with-dependencies $@

$(MANDIR)/shinycannon.1: shinycannon.1.ronn
	mkdir -p $(dir $@)
	cat $< |ronn -r --manual="SHINYCANNON MANUAL" --pipe > $@

$(RPM_FILE): $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	fpm -t rpm $(FPM_ARGS)

$(DEB_FILE): $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	fpm -t deb $(FPM_ARGS)

publish: $(RPM_FILE) $(DEB_FILE)
	aws s3 cp $(RPM_FILE) s3://$(BUCKET_NAME)/$(VERSION)-$(GIT_SHA)/rpm/
	aws s3 cp $(DEB_FILE) s3://$(BUCKET_NAME)/$(VERSION)-$(GIT_SHA)/deb/

clean:
	rm -rf package target
	rm -f *.rpm *.deb
