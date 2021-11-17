
[Cozy][cozy] Cozy konnector for GEG

=======================================



What's Cozy?

------------



![Cozy Logo](https://cdn.rawgit.com/cozy/cozy-guidelines/master/templates/cozy_logo_small.svg)



[Cozy] is a personal data platform that brings all your web services in the same private space. With it, your webapps and your devices can share data easily, providing you with a new experience. You can install Cozy on your own hardware where no one's tracking you.



What is this konnector about ?

------------------------------



This konnector retrieves your bills from a given contract number attached to your [GEG client area](https://monagence.geg.fr/). It is aimed to work with GEG client area.


### Open a Pull-Request

If you want to work on this konnector and submit code modifications, feel free to open merge-requests!

</br>See :

* the [contributing guide][contribute] for more information about how to properly open pull-requests.

* the [konnectors development guide](https://docs.cozy.io/en/tutorials/konnector/)



### Run and test



Create a `konnector-dev-config.json` file at the root with your test credentials :



```javascript

{

"COZY_URL": "http://cozy.tools:8080",

"fields": {"login":"your_email_address@domain.tld",  "password":"********"}

}

```

Then :



```sh

yarn

yarn standalone

```

For running the konnector connected to a Cozy server and more details see [konnectors tutorial](https://docs.cozy.io/en/tutorials/konnector/)



### Cozy-konnector-libs



This connector uses [cozy-konnector-libs](https://github.com/cozy/cozy-konnector-libs). It brings a bunch of helpers to interact with the Cozy server and to fetch data from an online service.



### Maintainer



The lead maintainers for this konnector is [KAPT](https://www.kapt.mobi/) on behalf of the [SDED](https://www.sded.org/).




### Get in touch



You can reach the Cozy Community by:



-  [Konnectors tutorial](https://docs.cozy.io/en/tutorials/konnector/)

- Chatting with us on IRC [#cozycloud on Libera.Chat][libera]

- Posting on our [Forum]

- Posting issues on the [Gitlab repo][gitlab]

- Say Hi! on [Twitter]




License

-------



cozy-konnector-geg is developed by [KAPT](https://www.kapt.mobi/) and distributed under the [AGPL v3 license][agpl-3.0].



[cozy]:  https://cozy.io  "Cozy Cloud"

[agpl-3.0]:  https://www.gnu.org/licenses/agpl-3.0.html

[libera]:  https://web.libera.chat/#cozycloud

[forum]:  https://forum.cozy.io/

[gitlab]: https://gitlab.com/kapt/open-source/cozy-konnector-geg

[nodejs]:  https://nodejs.org/

[standard]:  https://standardjs.com

[twitter]:  https://twitter.com/mycozycloud

[webpack]:  https://webpack.js.org

[yarn]:  https://yarnpkg.com

[travis]:  https://travis-ci.org

[contribute]:  CONTRIBUTING.md
