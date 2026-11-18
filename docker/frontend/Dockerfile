# This file is a part of the ergofox project
# Copyright 2020 Alex Woroschilow (alex@ergofox.me)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
FROM ubuntu:26.04
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_OPTIONS=--max-old-space-size=8192
ENV WINEDLLOVERRIDES="mscoree,mshtml="
ENV WINEDEBUG="-all"
ENV DISPLAY=:99

ARG UID
ARG GID
ARG USER
ARG ENVIRONMENT
ARG DEBUG

RUN apt-get update -y --fix-missing && \
        apt-get install -y apt-utils && \
        apt-get install -y software-properties-common && \
        apt-get upgrade -y

RUN apt-get install -y htop && \
        apt-get install -y mc && \
        apt-get install -y gcc g++ make && \
        apt-get install -y wget && \
        apt-get install -y curl

RUN apt-get --purge remove -y nodejs && \
        apt-get --purge remove -y npm

RUN curl -sL https://deb.nodesource.com/setup_22.x | bash - && \
        apt-get install -y nodejs && \
        npm install --global --allow-scripts=pnpm pnpm

RUN mkdir --parents /srv

RUN groupadd -f -g ${GID:-1000} ${USER:-developer} \
    && useradd -m -o -u ${UID:-1000} -g ${GID:-1000} ${USER:-developer}

RUN mkdir --parents /srv && \
    chown -R ${USER:-developer}:${USER:-developer} /srv

USER ${USER:-developer}
