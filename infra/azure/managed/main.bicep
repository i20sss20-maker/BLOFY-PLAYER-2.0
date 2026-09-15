targetScope = 'resourceGroup'

@description('Primary Azure region for BLOFY PLAYER managed services.')
param location string = resourceGroup().location

@description('Short environment suffix used in globally unique resource names.')
param environment string = 'prod'

@secure()
param postgresAdministratorPassword string

@secure()
param blofyAdminToken string

@secure()
param blofyPlaylistEncryptionKey string

@secure()
param releaseAdminPassword string

param postgresAdministratorLogin string = 'blofypgadmin'
param postgresDatabaseName string = 'blofy'

var suffix = uniqueString(subscription().subscriptionId, resourceGroup().id)
var prefix = 'blofy-${environment}'
var tags = {
  app: 'BLOFY PLAYER'
  environment: environment
  managedBy: 'bicep'
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${prefix}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.60.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'container-apps'
        properties: {
          addressPrefix: '10.60.0.0/27'
          delegations: [
            {
              name: 'container-apps-environment'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: '10.60.1.0/28'
          delegations: [
            {
              name: 'postgres-flexible-server'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
    ]
  }
}

resource containerSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: 'container-apps'
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  parent: vnet
  name: 'postgres'
}

resource postgresDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'blofy.${environment}.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresDns
  name: '${prefix}-vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'blofy-${environment}-pg-${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdministratorLogin
    administratorLoginPassword: postgresAdministratorPassword
    version: '16'
    availabilityZone: '1'
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: postgresSubnet.id
      privateDnsZoneArmResourceId: postgresDns.id
    }
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
  }
  dependsOn: [postgresDnsLink]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: postgresDatabaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs-${suffix}'
  location: location
  tags: tags
  properties: {
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource environmentResource 'Microsoft.App/managedEnvironments@2026-01-01' = {
  name: '${prefix}-apps'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: listKeys(logs.id, '2020-08-01').primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: containerSubnet.id
      internal: false
    }
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: 'blofy${environment}${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    dataEndpointEnabled: false
    networkRuleBypassOptions: 'AzureServices'
    publicNetworkAccess: 'Enabled'
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${prefix}-runtime'
  location: location
  tags: tags
}

resource keyVault 'Microsoft.KeyVault/vaults@2025-05-01' = {
  name: 'blofykv${suffix}'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: 'blofy${environment}st${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

var databaseUrl = 'postgresql://${postgresAdministratorLogin}:${postgresAdministratorPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${postgresDatabaseName}?sslmode=require'

resource databaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = {
  parent: keyVault
  name: 'database-url'
  properties: {
    value: databaseUrl
  }
}

resource adminTokenSecret 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = {
  parent: keyVault
  name: 'blofy-admin-token'
  properties: {
    value: blofyAdminToken
  }
}

resource playlistKeySecret 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = {
  parent: keyVault
  name: 'playlist-encryption-key'
  properties: {
    value: blofyPlaylistEncryptionKey
  }
}

resource releasePasswordSecret 'Microsoft.KeyVault/vaults/secrets@2025-05-01' = {
  parent: keyVault
  name: 'release-admin-password'
  properties: {
    value: releaseAdminPassword
  }
}

var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var keyVaultSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var blobDataContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRole)
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
  }
}

resource keyVaultRead 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identity.id, keyVaultSecretsUserRole)
  scope: keyVault
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRole
  }
}

resource storageWrite 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, identity.id, blobDataContributorRole)
  scope: storage
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobDataContributorRole
  }
}

var runtimeIdentity = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${identity.id}': {}
  }
}

var acrRegistry = [
  {
    server: acr.properties.loginServer
    identity: identity.id
  }
]

resource activation 'Microsoft.App/containerApps@2026-01-01' = {
  name: 'blofy-activation'
  location: location
  tags: tags
  identity: runtimeIdentity
  properties: {
    managedEnvironmentId: environmentResource.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 8080
        transport: 'http'
      }
      registries: acrRegistry
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: databaseUrlSecret.properties.secretUri
          identity: identity.id
        }
        {
          name: 'admin-token'
          keyVaultUrl: adminTokenSecret.properties.secretUri
          identity: identity.id
        }
        {
          name: 'playlist-key'
          keyVaultUrl: playlistKeySecret.properties.secretUri
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'activation'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          env: [
            { name: 'PORT', value: '8080' }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PGSSLMODE', value: 'require' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'BLOFY_ADMIN_TOKEN', secretRef: 'admin-token' }
            { name: 'BLOFY_PLAYLIST_ENCRYPTION_KEY', secretRef: 'playlist-key' }
            { name: 'BLOFY_TRIAL_DAYS', value: '7' }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
      }
    }
  }
  dependsOn: [acrPull, keyVaultRead]
}

resource releases 'Microsoft.App/containerApps@2026-01-01' = {
  name: 'blofy-releases'
  location: location
  tags: tags
  identity: runtimeIdentity
  properties: {
    managedEnvironmentId: environmentResource.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 3000
        transport: 'http'
      }
      registries: acrRegistry
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: databaseUrlSecret.properties.secretUri
          identity: identity.id
        }
        {
          name: 'release-admin-password'
          keyVaultUrl: releasePasswordSecret.properties.secretUri
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'releases'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          env: [
            { name: 'PORT', value: '3000' }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PGSSLMODE', value: 'require' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'ADMIN_PASSWORD', secretRef: 'release-admin-password' }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
  dependsOn: [acrPull, keyVaultRead]
}

resource gateway 'Microsoft.App/containerApps@2026-01-01' = {
  name: 'blofy-gateway'
  location: location
  tags: tags
  identity: runtimeIdentity
  properties: {
    managedEnvironmentId: environmentResource.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8080
        transport: 'http'
      }
      registries: acrRegistry
    }
    template: {
      containers: [
        {
          name: 'gateway'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          env: [
            { name: 'PORT', value: '8080' }
            { name: 'ACTIVATION_URL', value: 'http://blofy-activation' }
            { name: 'RELEASE_URL', value: 'http://blofy-releases' }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
      }
    }
  }
  dependsOn: [acrPull]
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output keyVaultName string = keyVault.name
output postgresServer string = postgres.properties.fullyQualifiedDomainName
output activationApp string = activation.name
output releasesApp string = releases.name
output gatewayApp string = gateway.name
output gatewayFqdn string = gateway.properties.configuration.ingress.fqdn
output gatewayUrl string = 'https://${gateway.properties.configuration.ingress.fqdn}'
output storageAccountName string = storage.name
