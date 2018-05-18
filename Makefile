VERSION=$(shell xmllint --xpath '/*[local-name()="project"]/*[local-name()="version"]/text()' pom.xml)
UBERJAR=target/shinycannon-$(VERSION)-jar-with-dependencies.jar
GIT_SHA=$(shell git rev-parse --short HEAD)

PREFIX=package/usr/local
BINDIR=$(PREFIX)/bin
MANDIR=$(PREFIX)/share/man/man1

FPM_ARGS=--iteration $(GIT_SHA) -f -s dir -n shinycannon -v $(VERSION) -C package .

.PHONY: all clean rpm deb

all: rpm deb

$(UBERJAR):
	mvn package

$(BINDIR)/shinycannon: $(UBERJAR)
	mkdir -p $(dir $@)
	/opt/graal/bin/native-image -H:+ReportUnsupportedElementsAtRuntime -jar $<
	mv shinycannon-$(VERSION)-jar-with-dependencies $@

$(MANDIR)/shinycannon.1: shinycannon.1.ronn
	mkdir -p $(dir $@)
	cat $< |ronn -r --manual="SHINYCANNON MANUAL" --pipe > $@

shinycannon-$(VERSION)-$(GIT_SHA).x86_64.rpm: $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	fpm -t rpm $(FPM_ARGS)

shinycannon_$(VERSION)-$(GIT_SHA)_amd64.deb: $(BINDIR)/shinycannon $(MANDIR)/shinycannon.1
	fpm -t deb $(FPM_ARGS)

rpm: shinycannon-$(VERSION)-$(GIT_SHA).x86_64.rpm
deb: shinycannon_$(VERSION)-$(GIT_SHA)_amd64.deb

clean:
	rm -rf package target
	rm -f shinycannon-$(VERSION)-$(GIT_SHA).x86_64.rpm
