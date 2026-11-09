@allowed(['demo', 'production'])
param environment string
param adminGitHubLogins string
param location string = resourceGroup().location
param staticSiteLocation string = 'eastus2'
param namePrefix string = 'entre-senderos'
param demoAdminUsername string = 'demo-admin'
param productionAllowedDomain string = ''
param productionTenantId string = ''
param productionClientId string = ''
@secure()
param productionClientSecret string = ''
@secure()
param demoPasswordHash string = ''
@secure()
param demoSessionSecret string = ''

var suffix = uniqueString(resourceGroup().id, environment, namePrefix)
var storageName = 'es${environment == 'production' ? 'prod' : 'demo'}${suffix}'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    accessTier: 'Hot'
  }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: { deleteRetentionPolicy: { enabled: true, days: 7 } }
}
resource content 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'content'
  properties: { publicAccess: 'None' }
}
resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [{
        name: 'expire-rate-limits'
        enabled: true
        type: 'Lifecycle'
        definition: {
          filters: { blobTypes: ['blockBlob'], prefixMatch: ['content/limits/'] }
          actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 1 } } }
        }
      }]
    }
  }
}
resource site 'Microsoft.Web/staticSites@2024-11-01' = {
  name: '${namePrefix}-${environment}-${suffix}'
  location: staticSiteLocation
  sku: environment == 'production' ? { name: 'Standard', tier: 'Standard' } : { name: 'Free', tier: 'Free' }
  properties: {
    provider: 'Custom'
    stagingEnvironmentPolicy: 'Disabled'
    buildProperties: { skipGithubActionWorkflowGeneration: true }
  }
}
resource settings 'Microsoft.Web/staticSites/config@2024-11-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${az.environment().suffixes.storage}'
    ADMIN_GITHUB_LOGINS: adminGitHubLogins
    APP_ENVIRONMENT: environment
    PRODUCTION_ALLOWED_DOMAIN: environment == 'production' ? productionAllowedDomain : ''
    PRODUCTION_ENTRA_TENANT_ID: environment == 'production' ? productionTenantId : ''
    PRODUCTION_ENTRA_CLIENT_ID: environment == 'production' ? productionClientId : ''
    PRODUCTION_ENTRA_CLIENT_SECRET: environment == 'production' ? productionClientSecret : ''
    DEMO_AUTH_ENABLED: environment == 'demo' && !empty(demoPasswordHash) && !empty(demoSessionSecret) ? 'true' : 'false'
    DEMO_ADMIN_USERNAME: demoAdminUsername
    DEMO_ADMIN_PASSWORD_HASH: environment == 'demo' ? demoPasswordHash : ''
    DEMO_SESSION_SECRET: environment == 'demo' ? demoSessionSecret : ''
  }
}

output siteName string = site.name
output hostname string = site.properties.defaultHostname
output storageAccountName string = storage.name
