# bConnect v2 — die Endpunkte, schwarz auf weiss

**Stand 2026-10-18.** Gregor: *"baramundi ist vorhanden und aktiv, nur das
Ansprechen ist noch ein schwarzes Loch — im Internet gibt es darueber gar
nichts."* Das Loch ist zu. Nicht durch Suchen, sondern durch die richtige
Quelle.

## Woher das hier kommt

Die offene Herstellerdokumentation (`docs.baramundi.com`) ist ein
Javascript-Betrachter: die Startseite antwortet, jeder Inhaltspfad leitet auf
die Startseite zurueck. Suchmaschinen finden darin nichts, und wir auch nicht.
Deshalb wirkt bConnect im Netz wie ein Geruecht.

Die Wahrheit liegt aber trotzdem oeffentlich — nur nicht als Text, sondern als
Code: **das PowerShell-Modul `bConnectV2` in der PowerShell Gallery** ist von
baramundi signiert (Zertifikat "baramundi software GmbH") und mit
*openapi-generator* aus der echten Schnittstellenbeschreibung erzeugt. Jeder
Aufruf steht dort mit Verb, Pfad und Rumpf im Klartext.

```bash
curl -L -o bc.nupkg https://www.powershellgallery.com/api/v2/package/bConnectV2
unzip bc.nupkg -d mod            # Modules/<Bereich>/Api/*.ps1
grep -rhoE "/v2\\.0/[A-Za-z0-9{}/]*" mod/Modules | sort -u
```

Die Tabellen unten sind genau so entstanden — mechanisch aus
`$LocalVarUri` und `-Method` der Api-Dateien, nicht von Hand abgetippt und
nicht geraten. Modulfassung: die zum 2026-10-18 aktuelle aus der Gallery
(bMS 26.1).

## Die Form des Aufrufs

```
https://{server}[:{port}]/bconnect/{bereich}/v2.0{pfad}
```

* **Bereich** ist der Modulordner in Kleinschreibung. Es gibt genau diese:
  `activedirectory`, `assets`, `compliance`, `defensecontrol`, `endpoints`,
  `jobs`, `operatingsystems`, `servermanagement`, `software`,
  `universaldynamicgroups`, `updatemanagement`, `variables`.
  Belegt in `Public/Set-bConnectConfig.ps1`:
  `BaseUrl = "https://$HostName/bconnect/$currentFolderNameLowerCase"`.
* **Port** nur, wenn abweichend von 443 — das Modul haengt ihn an den
  Hostnamen (`-Hostname "bServer.domain.net:8443"`, README des Moduls).
* **Anmeldung** `X-API-KEY: <schluessel>` *oder* `Authorization: Basic …`.
  Beides in `Private/Add-SecurityHeader.ps1`; der Schluessel gewinnt nur, wenn
  kein Benutzername gesetzt ist. Schluessel verwalten: `/v2.0/ApiKeys` im
  Bereich `servermanagement`.
* **Rumpf** `application/json; charset=utf-8`.
* **Listen** liefern ein Seitenobjekt mit `data` und `totalPages`. Vier
  Abfrageparameter, in jeder Liste dieselben: `Page`, `PageSize` (Vorgabe des
  Moduls beim Durchblaettern: 1000), `OrderBy`, `SearchQuery`.
  `SearchQuery` ist eine Freitextsuche — kein OData-Filter.
* **Feldnamen der Rueckgaben** stehen NICHT im Modul (nur die Rumpfe zum
  Anlegen sind modelliert). Die liefert `tools/bconnect-entdecken.js` aus dem
  laufenden Server.

## Was das fuer den Kiosk aendert

Vorher war im Portal vermerkt: die Leseendpunkte des Kiosk liegen nicht
woertlich vor, deshalb fuehrt das Portal seine Freigaben in einer eigenen
Tabelle. Jetzt liegen sie woertlich vor:

| Verb | Pfad (Bereich `jobs`) | wofuer |
|---|---|---|
| POST | `/v2.0/KioskReleases` | Freigabe erteilen — Rumpf `{ assignmentTargetId, jobDefinitionId }` |
| DELETE | `/v2.0/KioskReleases/{id}` | Freigabe zuruecknehmen |
| GET | `/v2.0/KioskReleases` | alle Freigaben, blaetterbar |
| GET | `/v2.0/KioskReleases/{id}` | eine Freigabe |
| GET | `/v2.0/JobDefinitions/{jobDefinitionId}/KioskReleases` | wer darf diese Software? |
| GET | `/v2.0/ADObjects/{adObjectId}/KioskReleases` | was darf dieser Benutzer? |
| GET | `/v2.0/Endpoints/{endpointId}/KioskReleases` | was darf dieses Geraet? |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/KioskReleases` | was darf diese Gruppe? |

Woertlich aus dem Modul, Datei `Modules/bConnectV2.Jobs/Api/BCJobsKioskReleasesApi.ps1`.
Rechte auf der bMS-Seite, woertlich aus dem Hilfetext derselben Datei:
`JobAssignTarget` auf der Jobdefinition, `SystemOrAdObjectAssignJob` auf dem
Zuweisungsziel.

Und das zweite offene Stueck — vom Anmeldenamen zum Zuweisungsziel — geht
ueber den Bereich `activedirectory`:

```
GET /bconnect/activedirectory/v2.0/ADUsers?SearchQuery=<anmeldename>&PageSize=5
GET /bconnect/activedirectory/v2.0/ADObjects?SearchQuery=<name>
GET /bconnect/activedirectory/v2.0/ADUsers/{id}
```

Die `id` eines AD-Objekts ist das, was `assignmentTargetId` erwartet. Welches
Feld der Antwort den Anmeldenamen traegt, ist im Modul nicht modelliert — das
muss am echten Server abgelesen werden, dafuer ist das Entdeckungswerkzeug da.

## Schnellprobe ohne unser Werkzeug

Auf einem Windows-Rechner im BFS-Netz braucht es dafuer gar nichts von uns —
das Herstellermodul selbst ist die kuerzeste Probe, ob bConnect antwortet:

```powershell
Install-Module bConnectV2 -Scope CurrentUser
$key = Read-Host -Prompt "API-Schluessel" -AsSecureString
Set-bConnectConfig -ApiKey $key -Hostname "bms.bfs.intern"   # Port anhaengen, falls nicht 443
Get-bCJobsJobDefinitions -PageSize 5 | Select-bCPageData     # Katalog
Get-bCJobsKioskReleases  -PageSize 5 | Select-bCPageData     # bestehende Kiosk-Freigaben
Get-bCActivedirectoryADUsers -SearchQuery "nachname" -PageSize 5 | Select-bCPageData
```

Kommen hier Zeilen zurueck, ist alles geklaert: bConnect laeuft, der
Schluessel gilt, und die Feldnamen stehen auf dem Schirm. Kommt ein Fehler,
sagt er welcher. Das ist der billigste erste Schritt — und er laeuft
ausschliesslich lesend.

## Erst messen, dann bauen

```bash
BCONNECT_SERVER=bms.bfs.intern BCONNECT_API_KEY=… node tools/bconnect-entdecken.js
```

Das Werkzeug fragt **nur lesend** (ausschliesslich GET), geht die zwoelf
Bereiche durch und sagt fuer jeden: antwortet er, ist der Schluessel gueltig,
ist der Bereich lizenziert — und wie heissen die Felder. Unterschieden wird
dabei 401/403 (Pfad richtig, Anmeldung oder Recht falsch) von 404 (Pfad
falsch). Das ist der Unterschied zwischen "geht nicht" und "darf nicht".

## Die vollstaendige Liste

264 Endpunkte in 12 Bereichen. `{…}` ist eine Kennung (GUID).

### `activedirectory`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/ADGroups` | `Get-bCActivedirectoryADGroups` |
| GET | `/v2.0/ADGroups/{adGroupId}/ADGroups` | `Get-bCActivedirectoryADGroupsByADGroupId` |
| GET | `/v2.0/ADGroups/{adGroupId}/ADObjects` | `Get-bCActivedirectoryADObjectsByADGroupId` |
| GET | `/v2.0/ADGroups/{adGroupId}/ADUsers` | `Get-bCActivedirectoryADUsersByADGroupId` |
| GET | `/v2.0/ADGroups/{id}` | `Get-bCActivedirectoryADGroupById` |
| GET | `/v2.0/ADObjects` | `Get-bCActivedirectoryADObjects` |
| GET | `/v2.0/ADObjects/{id}` | `Get-bCActivedirectoryADObjectById` |
| GET | `/v2.0/ADObjects/{id}/ADGroupMemberships` | `Get-bCActivedirectoryADObjectMemberships` |
| GET | `/v2.0/ADUsers` | `Get-bCActivedirectoryADUsers` |
| GET | `/v2.0/ADUsers/{id}` | `Get-bCActivedirectoryADUserById` |
| GET | `/v2.0/OrgUnits` | `Get-bCActivedirectoryOrgUnits` |
| GET | `/v2.0/OrgUnits/{id}` | `Get-bCActivedirectoryOrgUnit` |
| GET | `/v2.0/OrgUnits/{orgUnitId}/ADGroups` | `Get-bCActivedirectoryADGroupsByOrgUnitId` |
| GET | `/v2.0/OrgUnits/{orgUnitId}/ADObjects` | `Get-bCActivedirectoryADObjectsByOrgUnitId` |
| GET | `/v2.0/OrgUnits/{orgUnitId}/ADUsers` | `Get-bCActivedirectoryADUsersByOrgUnitId` |
| GET | `/v2.0/OrgUnits/{orgUnitId}/OrgUnits` | `Get-bCActivedirectoryOrgUnitsByOrgUnitId` |

### `assets`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/ADObjects/{adObjectId}/Assets` | `Get-bCAssetsAssetsByADObject` |
| GET | `/v2.0/AssetStock/Assets` | `Get-bCAssetsAssetsAssetStock` |
| GET | `/v2.0/AssetStock/Folders` | `Get-bCAssetsAssetStockFolders` |
| POST | `/v2.0/AssetStock/Folders` | `New-bCAssetsAssetStockFolder` |
| GET | `/v2.0/AssetStock/Folders/{folderId}/Folders` | `Get-bCAssetsAssetStockFoldersByParentId` |
| DELETE | `/v2.0/AssetStock/Folders/{id}` | `Remove-bCAssetsAssetStockFolder` |
| GET | `/v2.0/AssetStock/Folders/{id}` | `Get-bCAssetsAssetStockFolder` |
| PATCH | `/v2.0/AssetStock/Folders/{id}` | `Update-bCAssetsAssetStockFolder` |
| GET | `/v2.0/AssetTypes` | `Get-bCAssetsAssetTypes` |
| POST | `/v2.0/AssetTypes` | `New-bCAssetsAssetType` |
| GET | `/v2.0/AssetTypes/Folders` | `Get-bCAssetsAssetTypeFolders` |
| POST | `/v2.0/AssetTypes/Folders` | `New-bCAssetsAssetTypeFolder` |
| GET | `/v2.0/AssetTypes/Folders/{folderId}/Folders` | `Get-bCAssetsAssetTypeFoldersByParentId` |
| DELETE | `/v2.0/AssetTypes/Folders/{id}` | `Remove-bCAssetsAssetTypeFolder` |
| GET | `/v2.0/AssetTypes/Folders/{id}` | `Get-bCAssetsAssetTypeFolder` |
| PATCH | `/v2.0/AssetTypes/Folders/{id}` | `Update-bCAssetsAssetTypeFolder` |
| DELETE | `/v2.0/AssetTypes/{id}` | `Remove-bCAssetsAssetType` |
| GET | `/v2.0/AssetTypes/{id}` | `Get-bCAssetsAssetType` |
| GET | `/v2.0/Assets` | `Get-bCAssetsAssets` |
| POST | `/v2.0/Assets` | `New-bCAssetsAsset` |
| DELETE | `/v2.0/Assets/{id}` | `Remove-bCAssetsAsset` |
| GET | `/v2.0/Assets/{id}` | `Get-bCAssetsAsset` |
| PATCH | `/v2.0/Assets/{id}` | `Update-bCAssetsAsset` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/Assets` | `Get-bCAssetsAssetsByLogicalGroup` |
| GET | `/v2.0/OrgUnits/{orgUnitId}/Assets` | `Get-bCAssetsAssetsByOrgUnit` |
| GET | `/v2.0/WindowsEndpoint/{endpointId}/Assets` | `Get-bCAssetsAssetsByWindowsEndpoint` |

### `compliance`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/DetectedRuleViolations` | `Get-bCComplianceDetectedRuleViolations` |
| GET | `/v2.0/DetectedVulnerabilities` | `Get-bCComplianceAllDetectedVulnerabilities` |
| GET | `/v2.0/Endpoints/{endpointId}/DetectedRuleViolations` | `Get-bCComplianceDetectedRuleViolationsForEndpoint` |
| GET | `/v2.0/Rules` | `Get-bCComplianceAllMobileDeviceRules` |
| GET | `/v2.0/Rules/{id}` | `Get-bCComplianceMobileDeviceRule` |
| GET | `/v2.0/Vulnerabilities` | `Get-bCComplianceAllVulnerabilities` |
| GET | `/v2.0/Vulnerabilities/{id}` | `Get-bCComplianceVulnerability` |
| GET | `/v2.0/WindowsEndpoints/{endpointId}/DetectedVulnerabilities` | `Get-bCComplianceDetectedVulnerabilitiesByEndpoint` |

### `defensecontrol`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/BitLocker/WindowsEndpoints` | `Get-bCDefensecontrolBitLockerStates` |
| GET | `/v2.0/BitLocker/WindowsEndpoints/{id}` | `Get-bCDefensecontrolBitLockerStatesByWindowsEndpointId` |
| GET | `/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets` | `Get-bCDefensecontrolBitLockerSecretsByWindowsEndpointId` |
| PATCH | `/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets` | `Update-bCDefensecontrolBitLockerPinByWindowsEndpointId` |
| GET | `/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}` | `Get-bCDefensecontrolLocalAdminUserCredentialsByWindowsEndpointId` |
| PATCH | `/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}` | `Update-bCDefensecontrolLocalAdminUserCredentialsForWindowsEndpointId` |
| POST | `/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}/TriggerUpdateOnClient` | `Invoke-bCDefensecontrolTriggerUpdateOnClient` |
| GET | `/v2.0/MicrosoftDefender/LogicalGroups/{logicalGroupId}/Threats` | `Get-bCDefensecontrolMicrosoftDefenderThreatsByLogicalGroupId` |
| GET | `/v2.0/MicrosoftDefender/Threats` | `Get-bCDefensecontrolMicrosoftDefenderThreats` |
| GET | `/v2.0/MicrosoftDefender/Threats/{id}` | `Get-bCDefensecontrolMicrosoftDefenderThreat` |
| GET | `/v2.0/MicrosoftDefender/WindowsEndpoints` | `Get-bCDefensecontrolMicrosoftDefenderStates` |
| GET | `/v2.0/MicrosoftDefender/WindowsEndpoints/{endpointId}/Threats` | `Get-bCDefensecontrolMicrosoftDefenderThreatsByWindowsEndpointId` |
| GET | `/v2.0/MicrosoftDefender/WindowsEndpoints/{id}` | `Get-bCDefensecontrolMicrosoftDefenderStatesByWindowsEndpointId` |

### `endpoints`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/ADUsers/{adUserId}/AndroidEndpoints` | `Get-bCEndpointsAndroidEndpointsByADObjectId` |
| GET | `/v2.0/ADUsers/{adUserId}/Endpoints` | `Get-bCEndpointsEndpointsByADObjectId` |
| GET | `/v2.0/ADUsers/{adUserId}/IosEndpoints` | `Get-bCEndpointsIOSEndpointsByADObjectId` |
| GET | `/v2.0/ADUsers/{adUserId}/LinuxEndpoints` | `Get-bCEndpointsLinuxEndpointsByADObjectId` |
| GET | `/v2.0/ADUsers/{adUserId}/MacEndpoints` | `Get-bCEndpointsMacEndpointsByADObjectId` |
| GET | `/v2.0/ADUsers/{adUserId}/WindowsEndpoints` | `Get-bCEndpointsWindowsEndpointsByADObjectId` |
| GET | `/v2.0/AndroidEndpoints` | `Get-bCEndpointsAndroidEndpoints` |
| POST | `/v2.0/AndroidEndpoints` | `New-bCEndpointsAndroidEndpoint` |
| DELETE | `/v2.0/AndroidEndpoints/{id}` | `Remove-bCEndpointsAndroidEndpoint` |
| GET | `/v2.0/AndroidEndpoints/{id}` | `Get-bCEndpointsAndroidEndpoint` |
| PATCH | `/v2.0/AndroidEndpoints/{id}` | `Update-bCEndpointsAndroidEndpoint` |
| POST | `/v2.0/AndroidEndpoints/{id}/StartEnrollment` | `Start-bCEndpointsAndroidEndpointEnrollment` |
| GET | `/v2.0/DynamicGroups/{dynamicGroupId}/Endpoints` | `Get-bCEndpointsEndpointsByDynamicGroupId` |
| GET | `/v2.0/DynamicGroups/{dynamicGroupId}/WindowsEndpoints` | `Get-bCEndpointsWindowsEndpointsByDynamicGroupId` |
| GET | `/v2.0/Endpoints` | `Get-bCEndpointsEndpoints` |
| DELETE | `/v2.0/Endpoints/{endpointId}/EntraIdData` | `Remove-bCEndpointsEntraIdEndpointData` |
| POST | `/v2.0/Endpoints/{endpointId}/EntraIdData` | `Set-bCEndpointsEntraIdEndpointData` |
| DELETE | `/v2.0/Endpoints/{id}` | `Remove-bCEndpointsEndpoint` |
| GET | `/v2.0/Endpoints/{id}` | `Get-bCEndpointsEndpoint` |
| DELETE | `/v2.0/Endpoints/{id}/MaintenanceWindow` | `Remove-bCEndpointsMaintenanceWindowForEndpointById` |
| GET | `/v2.0/Endpoints/{id}/MaintenanceWindow` | `Get-bCEndpointsMaintenanceWindowForEndpointById` |
| PATCH | `/v2.0/Endpoints/{id}/MaintenanceWindow` | `Update-bCEndpointsMaintenanceWindowForEndpointById` |
| POST | `/v2.0/Endpoints/{id}/MaintenanceWindow` | `New-bCEndpointsMaintenanceWindowForEndpointById` |
| GET | `/v2.0/EntraIdData/{deviceId}` | `Get-bCEndpointsEntraIdEndpointDataByDeviceId` |
| GET | `/v2.0/IosEndpoints` | `Get-bCEndpointsIOSEndpoints` |
| POST | `/v2.0/IosEndpoints` | `New-bCEndpointsIOSEndpoint` |
| DELETE | `/v2.0/IosEndpoints/{id}` | `Remove-bCEndpointsIOSEndpoint` |
| GET | `/v2.0/IosEndpoints/{id}` | `Get-bCEndpointsIOSEndpoint` |
| PATCH | `/v2.0/IosEndpoints/{id}` | `Update-bCEndpointsIOSEndpoint` |
| POST | `/v2.0/IosEndpoints/{id}/StartEnrollment` | `Start-bCEndpointsIosEndpointEnrollment` |
| GET | `/v2.0/LinuxEndpoints` | `Get-bCEndpointsLinuxEndpoints` |
| POST | `/v2.0/LinuxEndpoints` | `New-bCEndpointsLinuxEndpoint` |
| DELETE | `/v2.0/LinuxEndpoints/{id}` | `Remove-bCEndpointsLinuxEndpoint` |
| GET | `/v2.0/LinuxEndpoints/{id}` | `Get-bCEndpointsLinuxEndpoint` |
| PATCH | `/v2.0/LinuxEndpoints/{id}` | `Update-bCEndpointsLinuxEndpoint` |
| GET | `/v2.0/LogicalGroups` | `Get-bCEndpointsLogicalGroups` |
| POST | `/v2.0/LogicalGroups` | `New-bCEndpointsLogicalGroup` |
| DELETE | `/v2.0/LogicalGroups/{id}` | `Remove-bCEndpointsLogicalGroup` |
| GET | `/v2.0/LogicalGroups/{id}` | `Get-bCEndpointsLogicalGroup` |
| PATCH | `/v2.0/LogicalGroups/{id}` | `Update-bCEndpointsLogicalGroup` |
| DELETE | `/v2.0/LogicalGroups/{id}/MaintenanceWindow` | `Remove-bCEndpointsMaintenanceWindowForLogicalGroupById` |
| GET | `/v2.0/LogicalGroups/{id}/MaintenanceWindow` | `Get-bCEndpointsMaintenanceWindowForLogicalGroupById` |
| PATCH | `/v2.0/LogicalGroups/{id}/MaintenanceWindow` | `Update-bCEndpointsMaintenanceWindowForLogicalGroupById` |
| POST | `/v2.0/LogicalGroups/{id}/MaintenanceWindow` | `New-bCEndpointsMaintenanceWindowForLogicalGroupById` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/AndroidEndpoints` | `Get-bCEndpointsAndroidEndpointsByLogicalGroupId` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/Endpoints` | `Get-bCEndpointsEndpointsByLogicalGroupId` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/IosEndpoints` | `Get-bCEndpointsIOSEndpointsByLogicalGroupId` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/LinuxEndpoints` | `Get-bCEndpointsLinuxEndpointsByLogicalGroupId` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/LogicalGroups` | `Get-bCEndpointsLogicalGroupsByLogicalGroupId` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/MacEndpoints` | `Get-bCEndpointsMacEndpointsByLogicalGroupId` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/NetworkEndpoints` | `Get-bCEndpointsNetworkEndpointsByLogicalGroupId` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/WindowsEndpoints` | `Get-bCEndpointsWindowsEndpointsByLogicalGroupId` |
| GET | `/v2.0/MacEndpoints` | `Get-bCEndpointsMacEndpoints` |
| POST | `/v2.0/MacEndpoints` | `New-bCEndpointsMacEndpoint` |
| DELETE | `/v2.0/MacEndpoints/{id}` | `Remove-bCEndpointsMacEndpoint` |
| GET | `/v2.0/MacEndpoints/{id}` | `Get-bCEndpointsMacEndpoint` |
| PATCH | `/v2.0/MacEndpoints/{id}` | `Update-bCEndpointsMacEndpoint` |
| POST | `/v2.0/MacEndpoints/{id}/StartEnrollment` | `Start-bCEndpointsMacEndpointEnrollment` |
| GET | `/v2.0/NetworkEndpoints` | `Get-bCEndpointsNetworkEndpoints` |
| POST | `/v2.0/NetworkEndpoints` | `New-bCEndpointsNetworkEndpoint` |
| DELETE | `/v2.0/NetworkEndpoints/{id}` | `Remove-bCEndpointsNetworkEndpoint` |
| GET | `/v2.0/NetworkEndpoints/{id}` | `Get-bCEndpointsNetworkEndpoint` |
| PATCH | `/v2.0/NetworkEndpoints/{id}` | `Update-bCEndpointsNetworkEndpoint` |
| GET | `/v2.0/StaticGroups/{staticGroupId}/AndroidEndpoints` | `Get-bCEndpointsAndroidEndpointsByStaticGroupId` |
| GET | `/v2.0/StaticGroups/{staticGroupId}/Endpoints` | `Get-bCEndpointsEndpointsByStaticGroupId` |
| GET | `/v2.0/StaticGroups/{staticGroupId}/IosEndpoints` | `Get-bCEndpointsIOSEndpointsByStaticGroupId` |
| GET | `/v2.0/StaticGroups/{staticGroupId}/LinuxEndpoints` | `Get-bCEndpointsLinuxEndpointsByStaticGroupId` |
| GET | `/v2.0/StaticGroups/{staticGroupId}/MacEndpoints` | `Get-bCEndpointsMacEndpointsByStaticGroupId` |
| GET | `/v2.0/StaticGroups/{staticGroupId}/NetworkEndpoints` | `Get-bCEndpointsNetworkEndpointsByStaticGroupId` |
| GET | `/v2.0/StaticGroups/{staticGroupId}/WindowsEndpoints` | `Get-bCEndpointsWindowsEndpointsByStaticGroupId` |
| GET | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/AndroidEndpoints` | `Get-bCEndpointsAndroidEndpointsByUniversalDynamicGroupId` |
| GET | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/Endpoints` | `Get-bCEndpointsEndpointsByUniversalDynamicGroupId` |
| GET | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/IosEndpoints` | `Get-bCEndpointsIOSEndpointsByUniversalDynamicGroupId` |
| GET | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/LinuxEndpoints` | `Get-bCEndpointsLinuxEndpointsByUniversalDynamicGroupId` |
| GET | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/MacEndpoints` | `Get-bCEndpointsMacEndpointsByUniversalDynamicGroupId` |
| GET | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/NetworkEndpoints` | `Get-bCEndpointsNetworkEndpointsByUniversalDynamicGroupId` |
| GET | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/WindowsEndpoints` | `Get-bCEndpointsWindowsEndpointsByUniversalDynamicGroupId` |
| GET | `/v2.0/UnmanagedEndpoints` | `Get-bCEndpointsAllUnmanagedEndpoints` |
| DELETE | `/v2.0/UnmanagedEndpoints/{id}` | `Remove-bCEndpointsUnmanagedEndpoint` |
| GET | `/v2.0/UnmanagedEndpoints/{id}` | `Get-bCEndpointsUnmanagedEndpoint` |
| GET | `/v2.0/WindowsEndpoints` | `Get-bCEndpointsWindowsEndpoints` |
| POST | `/v2.0/WindowsEndpoints` | `New-bCEndpointsWindowsEndpoint` |
| DELETE | `/v2.0/WindowsEndpoints/{id}` | `Remove-bCEndpointsWindowsEndpoint` |
| GET | `/v2.0/WindowsEndpoints/{id}` | `Get-bCEndpointsWindowsEndpoint` |
| PATCH | `/v2.0/WindowsEndpoints/{id}` | `Update-bCEndpointsWindowsEndpoint` |
| POST | `/v2.0/WindowsEndpoints/{id}/StartEnrollment` | `Start-bCEndpointsWindowsEndpointEnrollment` |
| POST | `/v2.0/WindowsEndpoints/{id}/TriggerInstallationViaIntune` | `Invoke-bCEndpointsTriggerInstallationViaIntune` |

### `jobs`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/ADObjects/{adObjectId}/KioskReleases` | `Get-bCJobsKioskReleasesByAdObjectId` |
| POST | `/v2.0/DynamicGroups/{dynamicGroupId}/AssignJobDefinition` | `Invoke-bCJobsAssignJobDefinitionToWindowsDynamicGroup` |
| GET | `/v2.0/DynamicGroups/{dynamicGroupId}/JobInstances` | `Get-bCJobsJobInstancesByDynamicGroupId` |
| GET | `/v2.0/Endpoints/{endpointId}/JobInstances` | `Get-bCJobsJobInstancesByEndpointId` |
| GET | `/v2.0/Endpoints/{endpointId}/KioskReleases` | `Get-bCJobsKioskReleasesByEndpointId` |
| GET | `/v2.0/Folders` | `Get-bCJobsFolders` |
| POST | `/v2.0/Folders` | `New-bCJobsFolder` |
| GET | `/v2.0/Folders/{folderId}/Folders` | `Get-bCJobsFoldersByFolderId` |
| GET | `/v2.0/Folders/{folderId}/JobDefinitions` | `Get-bCJobsJobDefinitionsByFolderId` |
| DELETE | `/v2.0/Folders/{id}` | `Remove-bCJobsFolder` |
| GET | `/v2.0/Folders/{id}` | `Get-bCJobsFolder` |
| PATCH | `/v2.0/Folders/{id}` | `Update-bCJobsFolder` |
| GET | `/v2.0/JobDefinitions` | `Get-bCJobsJobDefinitions` |
| GET | `/v2.0/JobDefinitions/{id}` | `Get-bCJobsJobDefinition` |
| GET | `/v2.0/JobDefinitions/{jobDefinitionId}/JobInstances` | `Get-bCJobsJobInstancesByJobDefinitionId` |
| GET | `/v2.0/JobDefinitions/{jobDefinitionId}/KioskReleases` | `Get-bCJobsKioskReleasesByJobDefinitionId` |
| GET | `/v2.0/JobInstances` | `Get-bCJobsJobInstances` |
| POST | `/v2.0/JobInstances` | `New-bCJobsJobInstance` |
| DELETE | `/v2.0/JobInstances/{id}` | `Remove-bCJobsJobInstance` |
| GET | `/v2.0/JobInstances/{id}` | `Get-bCJobsJobInstance` |
| POST | `/v2.0/JobInstances/{id}/Resume` | `Resume-bCJobsJobInstance` |
| POST | `/v2.0/JobInstances/{id}/Start` | `Start-bCJobsJobInstance` |
| POST | `/v2.0/JobInstances/{id}/Stop` | `Stop-bCJobsJobInstance` |
| GET | `/v2.0/KioskReleases` | `Get-bCJobsKioskReleases` |
| POST | `/v2.0/KioskReleases` | `New-bCJobsKioskRelease` |
| DELETE | `/v2.0/KioskReleases/{id}` | `Invoke-bCJobsWithdrawKioskRelease` |
| GET | `/v2.0/KioskReleases/{id}` | `Get-bCJobsKioskRelease` |
| POST | `/v2.0/LogicalGroups/{logicalGroupId}/AssignJobDefinition` | `Invoke-bCJobsAssignJobDefinitionToLogicalGroup` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/JobInstances` | `Get-bCJobsJobInstancesByLogicalGroupId` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/KioskReleases` | `Get-bCJobsKioskReleasesByLogicalGroupId` |
| POST | `/v2.0/StaticGroups/{staticGroupId}/AssignJobDefinition` | `Invoke-bCJobsAssignJobDefinitionToStaticGroup` |
| GET | `/v2.0/StaticGroups/{staticGroupId}/JobInstances` | `Get-bCJobsJobInstancesByStaticGroupId` |
| POST | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/AssignJobDefinition` | `Invoke-bCJobsAssignJobDefinitionToUniversalDynamicGroup` |
| GET | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/JobInstances` | `Get-bCJobsJobInstancesByUniversalDynamicGroupId` |

### `operatingsystems`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/Folders` | `Get-bCOperatingsystemsFolders` |
| POST | `/v2.0/Folders` | `New-bCOperatingsystemsFolder` |
| GET | `/v2.0/Folders/{folderId}/Folders` | `Get-bCOperatingsystemsFoldersByFolderId` |
| DELETE | `/v2.0/Folders/{id}` | `Remove-bCOperatingsystemsFolder` |
| GET | `/v2.0/Folders/{id}` | `Get-bCOperatingsystemsFolder` |
| PATCH | `/v2.0/Folders/{id}` | `Update-bCOperatingsystemsFolder` |
| GET | `/v2.0/WindowsEndpoints` | `Get-bCOperatingsystemsWindowsEndpoints` |
| GET | `/v2.0/WindowsEndpoints/{id}` | `Get-bCOperatingsystemsWindowsEndpoint` |
| PATCH | `/v2.0/WindowsEndpoints/{id}` | `Update-bCOperatingsystemsWindowsEndpoint` |

### `servermanagement`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/ApiKeys` | `Get-bCServermanagementApiKeys` |
| POST | `/v2.0/CancelScheduledRestart` | `Stop-bCServermanagementScheduledRestartBaramundiManagementServer` |
| GET | `/v2.0/CloudConnectors` | `Get-bCServermanagementCloudConnectors` |
| GET | `/v2.0/Dips` | `Get-bCServermanagementDipStatus` |
| POST | `/v2.0/Dips/MSWCleanup` | `Invoke-bCServermanagementMSWCleanup` |
| POST | `/v2.0/Dips/SimulateMSWCleanup` | `Invoke-bCServermanagementSimulateMSWCleanup` |
| GET | `/v2.0/DownloadJobs` | `Get-bCServermanagementDownloadJobs` |
| GET | `/v2.0/DownloadJobs/{id}` | `Get-bCServermanagementDownloadJob` |
| GET | `/v2.0/Gateway` | `Get-bCServermanagementGateway` |
| GET | `/v2.0/ManagementServer` | `Get-bCServermanagementManagementServer` |
| GET | `/v2.0/Microservices` | `Get-bCServermanagementMicroservices` |
| GET | `/v2.0/Microservices/{id}` | `Get-bCServermanagementMicroservice` |
| POST | `/v2.0/Microservices/{id}/Restart` | `Restart-bCServermanagementMicroservice` |
| POST | `/v2.0/Microservices/{id}/Start` | `Start-bCServermanagementMicroservice` |
| POST | `/v2.0/Microservices/{id}/Stop` | `Stop-bCServermanagementMicroservice` |
| PATCH | `/v2.0/Objects/{id}` | `Update-bCServermanagementObjectPermission` |
| GET | `/v2.0/Objects/{id}/Rights` | `Get-bCServermanagementAccessRights` |
| GET | `/v2.0/PxeRelays` | `Get-bCServermanagementPxeRelays` |
| POST | `/v2.0/Restart` | `Restart-bCServermanagementBaramundiManagementServer` |
| GET | `/v2.0/SecurityGroups` | `Get-bCServermanagementSecurityGroups` |
| POST | `/v2.0/SecurityGroups` | `New-bCServermanagementSecurityGroup` |
| DELETE | `/v2.0/SecurityGroups/{id}` | `Remove-bCServermanagementSecurityGroup` |
| GET | `/v2.0/SecurityGroups/{id}` | `Get-bCServermanagementSecurityGroup` |
| PATCH | `/v2.0/SecurityGroups/{id}` | `Update-bCServermanagementSecurityGroup` |
| GET | `/v2.0/SecurityProfiles` | `Get-bCServermanagementSecurityProfiles` |
| POST | `/v2.0/SecurityProfiles` | `New-bCServermanagementSecurityProfile` |
| DELETE | `/v2.0/SecurityProfiles/{id}` | `Remove-bCServermanagementSecurityProfile` |
| GET | `/v2.0/SecurityProfiles/{id}` | `Get-bCServermanagementSecurityProfile` |
| PATCH | `/v2.0/SecurityProfiles/{id}` | `Update-bCServermanagementSecurityProfile` |
| GET | `/v2.0/VpnAppliance` | `Get-bCServermanagementVpnAppliance` |

### `software`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/Bundle/Folders` | `Get-bCSoftwareBundleFolders` |
| POST | `/v2.0/Bundle/Folders` | `New-bCSoftwareBundleFolder` |
| GET | `/v2.0/Bundle/Folders/{folderId}/Folders` | `Get-bCSoftwareBundleFoldersByFolderId` |
| DELETE | `/v2.0/Bundle/Folders/{id}` | `Remove-bCSoftwareBundleFolder` |
| GET | `/v2.0/Bundle/Folders/{id}` | `Get-bCSoftwareBundleFolder` |
| PATCH | `/v2.0/Bundle/Folders/{id}` | `Update-bCSoftwareBundleFolder` |
| GET | `/v2.0/BundleApplications` | `Get-bCSoftwareBundleApplications` |
| DELETE | `/v2.0/BundleApplications/{id}` | `Remove-bCSoftwareBundleApplicationById` |
| GET | `/v2.0/Bundles` | `Get-bCSoftwareSoftwareBundles` |
| POST | `/v2.0/Bundles` | `New-bCSoftwareBundle` |
| GET | `/v2.0/Bundles/{bundleId}/BundleApplications` | `Get-bCSoftwareBundleApplicationsByBundleId` |
| POST | `/v2.0/Bundles/{bundleId}/BundleApplications` | `Add-bCSoftwareApplicationToBundle` |
| PATCH | `/v2.0/Bundles/{bundleId}/BundleApplications/{id}` | `Invoke-bCSoftwareReplaceApplicationInBundle` |
| DELETE | `/v2.0/Bundles/{id}` | `Remove-bCSoftwareBundle` |
| GET | `/v2.0/Bundles/{id}` | `Get-bCSoftwareBundle` |
| GET | `/v2.0/InstalledWindowsSoftware` | `Get-bCSoftwareInstalledWindowsSoftware` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/InstalledWindowsSoftware` | `Get-bCSoftwareInstalledWindowsSoftwareByLogicalGroupId` |
| GET | `/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/InstalledWindowsSoftware` | `Get-bCSoftwareInstalledWindowsSoftwareByUniversalDynamicGroupId` |
| GET | `/v2.0/WindowsEndpoints/{endpointId}/InstalledWindowsSoftware` | `Get-bCSoftwareInstalledWindowsSoftwareByEndpointId` |

### `universaldynamicgroups`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/Folders/{folderId}/UniversalDynamicGroups` | `Get-bCUniversaldynamicgroupsUniversalDynamicGroupsByFolderId` |
| GET | `/v2.0/UniversalDynamicGroups` | `Get-bCUniversaldynamicgroupsUniversalDynamicGroups` |
| GET | `/v2.0/UniversalDynamicGroups/{id}` | `Get-bCUniversaldynamicgroupsUniversalDynamicGroup` |
| GET | `/v2.0/UniversalDynamicGroupsFolder` | `Get-bCUniversaldynamicgroupsFolders` |
| GET | `/v2.0/UniversalDynamicGroupsFolder/{folderId}/Folders` | `Get-bCUniversaldynamicgroupsFoldersByFolderId` |
| GET | `/v2.0/UniversalDynamicGroupsFolder/{id}` | `Get-bCUniversaldynamicgroupsFolder` |

### `updatemanagement`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/WindowsEndpoints` | `Get-bCUpdatemanagementWindowsEndpoints` |
| GET | `/v2.0/WindowsEndpoints/{id}` | `Get-bCUpdatemanagementWindowsEndpoint` |
| PATCH | `/v2.0/WindowsEndpoints/{id}` | `Update-bCUpdatemanagementWindowsEndpoint` |

### `variables`
| Verb | Pfad | Cmdlet |
|---|---|---|
| GET | `/v2.0/ADObjects/{adObjectId}/VariableInstances` | `Get-bCVariablesVariableInstancesByADObjectId` |
| GET | `/v2.0/Endpoints/{endpointId}/VariableInstances` | `Get-bCVariablesVariableInstancesByEndpointId` |
| GET | `/v2.0/LogicalGroups/{logicalGroupId}/VariableInstances` | `Get-bCVariablesVariableInstancesByLogicalGroupId` |
| GET | `/v2.0/VariableDefinitions` | `Get-bCVariablesVariableDefinitions` |
| POST | `/v2.0/VariableDefinitions` | `New-bCVariablesVariableDefinition` |
| DELETE | `/v2.0/VariableDefinitions/{id}` | `Remove-bCVariablesVariableDefinition` |
| GET | `/v2.0/VariableDefinitions/{id}` | `Get-bCVariablesVariableDefinitionById` |
| PATCH | `/v2.0/VariableDefinitions/{id}` | `Update-bCVariablesVariableDefinition` |
| GET | `/v2.0/VariableInstances` | `Get-bCVariablesVariableInstances` |
| GET | `/v2.0/VariableInstances/{id}` | `Get-bCVariablesVariableInstanceById` |
| PATCH | `/v2.0/VariableInstances/{id}` | `Update-bCVariablesVariableInstance` |
| GET | `/v2.0/WindowsApplications/{windowsApplicationId}/VariableInstances` | `Get-bCVariablesVariableInstancesByWindowsApplicationId` |
| GET | `/v2.0/WindowsJobDefinitions/{windowsJobDefinitionId}/VariableInstances` | `Get-bCVariablesVariableInstancesByWindowsJobDefinitonId` |

## Was damit noch nicht geklaert ist

* **Ob BFS diese Bereiche lizenziert hat.** Die Liste ist die Schnittstelle des
  Produkts, nicht die eurer Installation. `bconnect-entdecken.js` beantwortet
  das pro Bereich.
* **Die Feldnamen der Antworten.** Siehe oben — nur am laufenden Server
  ablesbar.
* **Ob bConnect bei euch eingeschaltet ist.** Es ist eine eigene Komponente
  der bMS-Installation mit eigenen Schluesseln.
* **Nichts davon ist gegen einen echten bMS-Server gelaufen.** Alles hier ist
  aus signiertem Herstellercode gelesen und gegen den Nachbau
  (`tools/bconnect-mock.js`) geprueft.
