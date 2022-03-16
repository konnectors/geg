process.env.SENTRY_DSN =
  process.env.SENTRY_DSN ||
  'https://a6c3731ddfed4735814c29b6c9602389@errors.cozycloud.cc/34'

const {
  BaseKonnector,
  requestFactory,
  log,
  utils,
  errors,
  cozyClient
} = require('cozy-konnector-libs')
const stream = require('stream')

const VENDOR = 'geg'

// The URLs of the client area
const BASE_URL = 'https://monagence.geg.fr/aelPROD/jsp/arc/habilitation/'
const MAIN_API_URL = `${BASE_URL}acteur.ZoomerDossierClient.go`
const DO_LOGIN_URL = `${BASE_URL}habilitation.ActorIdentification.go?act=valider&_rqId_=0&ns=9002&cs=5011&fs=9001`
const DOCUMENTS_URL = `${BASE_URL}contrat.ZoomerDocumentOConsultation.go`
const INVOICE_FILE_URL = `${BASE_URL}contrat.ZoomerContratOFactures.go`

const cookieJar = requestFactory().jar()

const userAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.58 Safari/537.36'

const requestParams = {
  // The debug mode shows all the details about HTTP requests and responses. Very useful for
  // debugging but very verbose. This is why it is commented out by default
  debug: false,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,

  // This allows request-promise to keep cookies between requests
  jar: cookieJar,

  headers: {
    'User-Agent': userAgent,
    Accept: 'text/html'
  }
}

// A [request](https://github.com/request/request-promise) instance, with cheerio and full response
const cheerioRequest = requestFactory({
  ...requestParams,

  // Activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,

  // Inject full response on cheerio requests, allowing to check for response status code
  resolveWithFullResponse: true
})

// A [request](https://github.com/request/request-promise) instance, without cheerio.
// Used to download PDF files
const rawRequest = requestFactory({
  ...requestParams,
  // Des-activate [cheerio](https://cheerio.js.org/) parsing
  cheerio: false
})

// Importing models to get qualification by label
const models = cozyClient.new.models
const { Qualification } = models.document

// A global unique counter used in the server-side
// of client area to count the number of requests made
// by the client. The value is returned in every request
// by the server and must be posted by the client.
// Starts at 0 on the first request.
let rqIdVal = 0

// A global variable to store a "_sbs_" value that is session determined and that must be included in all requests made to the server.
// The value is retrieved on success login and stored in this variable
let sbsVal = null

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
// cozyParameters are static parameters, independents from the account. Most often, it can be a
// secret api key.
async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) {
    log('debug', 'Found COZY_PARAMETERS:')
    log('debug', cozyParameters)
  }

  await authenticate.bind(this)(fields.login, fields.password)
  log('info', 'Successfully logged in')

  // The BaseKonnector instance expects a Promise as return of the function

  // Get all contract ids of the client account
  let contractIds = await getContractIds()

  for (const contractId of contractIds) {
    log('debug', 'Fetching invoices for contract id: ' + contractId)

    // Fetch invoices details
    const invoices = await getContractInvoicesLines(fields, contractId)

    // Save invoices details to cozy instance
    await saveInvoices.bind(this)(fields, invoices)
  }
}

// Updates the global rqIdVal value
function updateRqIdVal($page) {
  const pageValue = $page('input[name=_rqId_]').val()

  if (pageValue) {
    // log('debug', `Updating rqIdVal to: ${pageValue}`, 'updateRqIdVal')
    rqIdVal = pageValue
  }
}

/*
A wrapper around Cheerio request to perform a POST request, checking the status code of the request.

Args:
  - uri: The URL of the request to perform
  - form: The data to POST

Returns:
- The full request
*/
async function postRequest(uri, form) {
  // log('debug', `POST request to : ${uri}`)
  // log('debug', 'with form : ')
  // log('debug', form)

  const fullResponse = await cheerioRequest({
    uri: uri,
    method: 'POST',
    form: form
  })

  const statusCode = fullResponse.statusCode

  // TODO: Handle try / catch blocks
  if (statusCode !== 200) {
    log('debug', statusCode, 'error')
    throw new Error(errors.VENDOR_DOWN)
  }

  updateRqIdVal(fullResponse.body)

  return fullResponse
}

/*
A wrapper around Cheerio request to perform a GET request, checking the status code of the request.

Args:
  - uri: The URL of the request to perform
  - qs: The query params
  - req: The type of request to perform. Default to cheerio request, can also be a "regular" request

Returns:
- The full request
*/
async function getRequest(uri, qs = {}) {
  // log('debug', `GET request to : ${uri}`)
  // log('debug', 'with query : ')
  // log('debug', qs)

  const fullResponse = await cheerioRequest({
    uri: uri,
    qs: qs
  })

  const statusCode = fullResponse.statusCode

  // TODO: Handle try / catch blocks
  if (statusCode !== 200) {
    throw new Error(errors.VENDOR_DOWN)
  }

  updateRqIdVal(fullResponse.body)

  return fullResponse
}

// Authenticates the client using the login page.
// The login mechanism is a session on the server side, using a session_id cookie, that must be kept on the cookiejar ot all requests.
async function authenticate(username, password) {
  // The use of the sign-in function is not mandatory in a connector and won't work if the sign-in page does not use html forms. Here, a simple POST request may be a lot more simple.

  // -> We use a simple POST request to login as HP is blocked if you access it more than 3 times in 120 minutes, so it's easier to POST data directly as if we came from the main site: https://particuliers.geg.fr/
  const loginResponse = await postRequest(DO_LOGIN_URL, {
    lg: username,
    psw: password
  })

  const fullResponse = loginResponse
  const statusCode = loginResponse.statusCode
  const parsedBody = loginResponse.body

  if (!statusCode === 200) {
    throw new Error(errors.LOGIN_FAILED)
  } else if (fullResponse.request.uri.href !== DO_LOGIN_URL) {
    throw new Error(errors.LOGIN_FAILED)
  } else if (parsedBody('#fermerSession').length !== 1) {
    throw new Error(errors.LOGIN_FAILED)
  }

  // Login was successful, extract the _sbs_ value from the HP
  sbsVal = parsedBody('input[name=_sbs_]').val()
  // log('debug', 'Assigned sbsVal to: ' + sbsVal)
}

async function getContractIds() {
  // The GEG client area is splitted by contract identifiers.
  // We must precise a contract id in the search engine to then extract the invoices, otherwise the search engine complains that there are too many contracts.
  // The complete contract Ids list is available in the "Mes documents" section of the client area.
  // This function extracts the complete list of these contracts from this page.
  log(
    'info',
    'Fetching the list of contract identifiers on the "Mes documents" page'
  )

  const contractIds = []

  const $myDocumentsPage = (
    await getRequest(DOCUMENTS_URL, {
      _rqId_: rqIdVal,
      _sbs_: sbsVal,
      act: 'demarrer'
    })
  ).body

  $myDocumentsPage('select[name=selectionReferenceContrat] option').each(
    (i, option) => {
      const optionVal = $myDocumentsPage(option).val()
      if (optionVal) {
        contractIds.push(optionVal)
      }
    }
  )

  log('debug', `Found ${contractIds.length} client contracts`, 'getContractIds')

  return contractIds
}

async function getContractHashValue(contractId) {
  // To consult the details of a given contract, we must extract its hash value, returned when posting the search engine page

  // Get the search engine page to update rqIdVal value
  await getRequest(MAIN_API_URL, {
    _rqId_: rqIdVal,
    _sbs_: sbsVal,
    act: 'demarrer'
  })

  // Post search engine page to get the contract hash value
  const $searchContractPage = (
    await postRequest(MAIN_API_URL, {
      _nwg_: '',
      _sbs_: sbsVal,
      act: 'basculerRechercheAvancee',
      _rqId_: rqIdVal,
      _ongIdx: '',
      _mnLck_: true,
      _startForm_: '',
      CRITERE_OFFRE_PRODUIT: '',
      CRITERE_STATUT_CONTRAT: '',
      CRITERE_REFERENCE_CONTRAT: contractId,
      CRITERE_REFERENCE_EXTERNE: '',
      CRITERE_NOM_TITULAIRE: '',
      CRITERE_REFERENCE_TITULAIRE: '',
      CRITERE_ROLE: '',
      CRITERE_SPECIFICITE: '',
      numero: '',
      typeDonneeGeo: 'VIDE',
      voie: '',
      codePostal: '',
      commune: '',
      CRITERE_REFERENCE_EDL: '',
      _endForm_: ''
    })
  ).body

  const contractHashId = $searchContractPage(
    "a[id^='consulterContratApresRecherche_']"
  ).attr('id')
  const contractHash = contractHashId.substring(31)

  log(
    'debug',
    `Extracted contract hash ${contractHash}, for contract id: ${contractId}`,
    'getContractHashValue'
  )

  return contractHash
}

async function getContractHomePage(contractId, contractHash) {
  await postRequest(MAIN_API_URL, {
    _nwg_: '',
    _sbs_: sbsVal,
    act: 'consulterContratApresRecherche',
    _rqId_: rqIdVal,
    _ongIdx: '',
    _mnLck_: true,
    _startForm_: '',
    CRITERE_OFFRE_PRODUIT: '',
    CRITERE_STATUT_CONTRAT: '',
    CRITERE_REFERENCE_CONTRAT: contractId,
    CRITERE_REFERENCE_EXTERNE: '',
    CRITERE_NOM_TITULAIRE: '',
    CRITERE_REFERENCE_TITULAIRE: '',
    CRITERE_ROLE: '',
    CRITERE_SPECIFICITE: '',
    numero: '',
    typeDonneeGeo: 'VIDE',
    voie: '',
    codePostal: '',
    commune: '',
    CRITERE_REFERENCE_EDL: '',
    sortFieldslisteResultatRechercheContrats: '',
    sortOrderslisteResultatRechercheContrats: '',
    actionSortlisteResultatRechercheContrats: '',
    selIdlisteResultatRechercheContrats: contractHash,
    listeDepliee: '',
    listeSize: 1,
    _endForm_: ''
  })
}

async function getContractInvoicesLines(fields, contractId) {
  const contractHash = await getContractHashValue(contractId)

  await getContractHomePage(contractId, contractHash)

  const $contractInvoices = (
    await postRequest(MAIN_API_URL, {
      _nwg_: '',
      _sbs_: sbsVal,
      act: 'consulterFactures',
      _rqId_: rqIdVal,
      _ongIdx: '',
      _mnLck_: false,
      _startForm_: '',
      EQUILIBRE_SERVICE_ID: '',
      typeAffaireHorsContrat: 'vide22546706795',
      _endForm_: ''
    })
  ).body

  const $tableLines = $contractInvoices('#tbl_mesFacturesExtrait tr')

  let invoiceLines = []

  $tableLines.each((i, tr) => {
    const invoiceLine = $contractInvoices(tr)
    const invoiceLineLinks = invoiceLine.find('a')

    invoiceLineLinks.each((j, a) => {
      const onClickAttr = $contractInvoices(a).attr('onclick')
      const onClickMatch = onClickAttr.match(
        /^validerConnexion[(]'([\w.?=&]+)'[)]$/
      )
      if (onClickMatch) {
        const invoiceActionURLStr = BASE_URL + onClickMatch[1]
        const invoiceActionURL = new URL(invoiceActionURLStr)
        const urlAction = invoiceActionURL.searchParams.get('act')

        if (urlAction === 'consulterFactureDuplicata') {
          const firstCell = $contractInvoices(invoiceLine.find('td')[0])
          const secondCell = $contractInvoices(invoiceLine.find('td')[1])
          const thirdCell = $contractInvoices(invoiceLine.find('td')[2])
          const fourthCell = $contractInvoices(invoiceLine.find('td')[3])
          const fifthCell = $contractInvoices(invoiceLine.find('td')[4])
          const invoiceId = firstCell.html()
          const invoiceDateStr = $contractInvoices(secondCell)
            .find('input')
            .val()
          const invoiceDateparts = invoiceDateStr.split('/')
          const invoiceDate = new Date(
            `${invoiceDateparts[2]}-${invoiceDateparts[1]}-${invoiceDateparts[0]}T00:00:00.000Z`
          )
          const amountExclTax = normalizePrice(
            $contractInvoices(thirdCell).find('input').val()
          )
          const amountInclTax = normalizePrice(
            $contractInvoices(fourthCell).find('input').val()
          )
          const status = $contractInvoices(fifthCell).find('input').val()

          invoiceLines.push({
            id: invoiceId,
            contractId: contractId,
            urlStr: invoiceActionURLStr,
            url: invoiceActionURL,
            amountExclTax: amountExclTax,
            amountInclTax: amountInclTax,
            status: status,
            expireDate: invoiceDate
          })
        }
      }
    })
  })

  if (fields.onlyLastNMonths && parseInt(fields.onlyLastNMonths) > 0) {
    let fromDate = new Date()
    fromDate.setMonth(fromDate.getMonth() - parseInt(fields.onlyLastNMonths))

    invoiceLines = invoiceLines.filter(invoice => {
      return invoice.expireDate >= fromDate
    })
  }

  return invoiceLines
}

async function fetchInvoice(entry) {
  const invoice = entry.invoice

  // log(
  //   'debug',
  //   `Downloading invoice file #${invoice.id}, for contract id #${invoice.contractId}`
  // )

  // It is necessary to make a GET request on the previous extracted URL and then to POST a form to retrieve the invoice
  const url = invoice.url
  await getRequest(`${url.origin}${url.pathname}`, {
    _rqId_: rqIdVal,
    _sbs_: sbsVal,
    act: url.searchParams.get('act'),
    selIdmesFacturesExtrait: url.searchParams.get('selIdmesFacturesExtrait')
  })

  const invoiceFileForm = {
    _nwg_: '',
    _sbs_: sbsVal,
    act: 'afficherDocument',
    _rqId_: rqIdVal,
    _ongIdx: '',
    _mnLck_: false,
    _startForm_: '',
    sortFieldsmesFacturesExtrait: '',
    sortOrdersmesFacturesExtrait: '',
    actionSortmesFacturesExtrait: '',
    selIdmesFacturesExtrait: '',
    listeDepliee: '',
    listeSize: 1,
    _endForm_: ''
  }

  // log('debug', `POST raw request to : ${INVOICE_FILE_URL}`)
  // log('debug', 'with form : ')
  // log('debug', invoiceFileForm)

  return rawRequest({
    uri: INVOICE_FILE_URL,
    method: 'POST',
    form: invoiceFileForm
  }).pipe(new stream.PassThrough())
}

async function saveInvoices(fields, invoices) {
  const documents = []

  for (const invoice of invoices) {
    // Due to the very specific way the requests are handled on the server side, the requests "GET https://monagence.geg.fr/aelPROD/jsp/arc/habilitation/contrat.ZoomerContratOFactures.go?_sbs_=211110170137_1&_rqId_=XXX&act=consulterFactureDuplicata&selIdmesFacturesExtrait=YYYYY" and "POST https://monagence.geg.fr/aelPROD/jsp/arc/habilitation/contrat.ZoomerContratOFactures.go" must absolutely being executed consecutively.
    // So we can't parallelize their dl
    const filename =
      `${utils.formatDate(invoice.expireDate)}_${VENDOR}_${
        invoice.contractId
      }` + `_${invoice.id}_${invoice.amountInclTax.toFixed(2)}EUR.pdf`

    documents.push({
      invoice: invoice,
      fetchFile: fetchInvoice,
      filename: filename,
      amount: invoice.amountInclTax,
      date: invoice.expireDate,
      vendor: VENDOR,
      contractId: invoice.contractId,
      vendorRef: invoice['id'],
      fileAttributes: {
        metadata: {
          carbonCopy: true,
          qualification: Qualification.getByLabel('energy_invoice'),
          datetime: invoice.expireDate,
          datetimeLabel: 'issueDate',
          contentAuthor: VENDOR,
          issueDate: invoice.expireDate
        }
      }
    })
  }
  await this.saveBills(documents, fields, {
    fileIdAttributes: ['vendorRef'],
    contentType: 'application/pdf',
    identifiers: ['vendor'],
    timeout: Date.now() + 400000 * 60 * 1000
  })
}

// Convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.replace(',', '.').trim())
}
