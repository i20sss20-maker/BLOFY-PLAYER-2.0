targetScope = 'subscription'

@description('Azure resource group used only for BLOFY staging.')
param resourceGroupName string = 'rg-blofy-staging'

@description('Start near Saudi Arabia. If the student VM SKU has no quota here, use westeurope.')
param location string = 'uaenorth'

param adminUsername string = 'blofyadmin'

@secure()
@description('SSH public key only. Password authentication is disabled.')
param sshPublicKey string

@description('Azure for Students currently includes 750 hours/month for this burstable size when available.')
param vmSize string = 'Standard_B2ats_v2'

@minLength(3)
@maxLength(40)
@description('Unique DNS label. The resulting FQDN is <label>.<region>.cloudapp.azure.com.')
param dnsLabelPrefix string

@description('Restrict this to your current public IP/CIDR after first setup when possible.')
param sshSourceCidr string = '0.0.0.0/0'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    app: 'BLOFY PLAYER'
    environment: 'staging'
    owner: 'blofy'
  }
}

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  scope: rg
  name: 'nsg-blofy-staging'
  location: location
  properties: {
    securityRules: [
      {
        name: 'Allow-HTTPS'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'Allow-HTTP-For-TLS'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '80'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'Allow-SSH-KeyOnly'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '22'
          sourceAddressPrefix: sshSourceCidr
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  scope: rg
  name: 'vnet-blofy-staging'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.42.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'app'
        properties: {
          addressPrefix: '10.42.1.0/24'
          networkSecurityGroup: {
            id: nsg.id
          }
        }
      }
    ]
  }
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  scope: rg
  name: 'pip-blofy-staging'
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: {
      domainNameLabel: dnsLabelPrefix
    }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  scope: rg
  name: 'nic-blofy-staging'
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'primary'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: {
            id: '${vnet.id}/subnets/app'
          }
          publicIPAddress: {
            id: publicIp.id
          }
        }
      }
    ]
  }
}

var cloudInit = replace(loadTextContent('cloud-init.yml'), '__ADMIN_USERNAME__', adminUsername)

resource vm 'Microsoft.Compute/virtualMachines@2024-11-01' = {
  scope: rg
  name: 'vm-blofy-staging'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    hardwareProfile: {
      vmSize: vmSize
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        name: 'disk-blofy-staging-os'
        createOption: 'FromImage'
        diskSizeGB: 64
        managedDisk: {
          storageAccountType: 'Premium_LRS'
        }
      }
    }
    osProfile: {
      computerName: 'blofy-staging'
      adminUsername: adminUsername
      customData: base64(cloudInit)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        provisionVMAgent: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
          properties: {
            primary: true
          }
        }
      ]
    }
    diagnosticsProfile: {
      bootDiagnostics: {
        enabled: true
      }
    }
  }
}

output publicIpAddress string = publicIp.properties.ipAddress
output fqdn string = publicIp.properties.dnsSettings.fqdn
output sshCommand string = 'ssh ${adminUsername}@${publicIp.properties.dnsSettings.fqdn}'
output resourceGroup string = rg.name
output vmName string = vm.name
