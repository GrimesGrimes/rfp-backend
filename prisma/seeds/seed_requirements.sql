-- REQUISITOS BASE (ejemplos mínimos por módulo)

-- AUTH
INSERT INTO "LibraryRequirement" ("moduleId","title","body","type")
SELECT (SELECT id FROM "LibraryModule" WHERE "key"='auth'),
       'SSO con OAuth2/OIDC','El sistema debe permitir SSO con OAuth2/OIDC (Google/Azure/Okta).','functional'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryRequirement" WHERE title='SSO con OAuth2/OIDC');

INSERT INTO "LibraryRequirement" ("moduleId","title","body","type")
SELECT (SELECT id FROM "LibraryModule" WHERE "key"='auth'),
       'MFA opcional','Habilitar MFA (TOTP/Email/SMS) configurable por rol.','functional'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryRequirement" WHERE title='MFA opcional');

-- INTEGRACIONES
INSERT INTO "LibraryRequirement" ("moduleId","title","body","type")
SELECT (SELECT id FROM "LibraryModule" WHERE "key"='integraciones'),
       'Conector SAP','Sincronizar clientes y pedidos desde SAP con reintentos y DLQ.','functional'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryRequirement" WHERE title='Conector SAP');

INSERT INTO "LibraryRequirement" ("moduleId","title","body","type")
SELECT (SELECT id FROM "LibraryModule" WHERE "key"='integraciones'),
       'Conector HubSpot','Alta de contactos y deals desde eventos de la plataforma.','functional'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryRequirement" WHERE title='Conector HubSpot');

-- REPORTING
INSERT INTO "LibraryRequirement" ("moduleId","title","body","type")
SELECT (SELECT id FROM "LibraryModule" WHERE "key"='reporting'),
       'Dashboards operativos','KPIs diarios con filtros por fecha, canal y segmento.','functional'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryRequirement" WHERE title='Dashboards operativos');

INSERT INTO "LibraryRequirement" ("moduleId","title","body","type")
SELECT (SELECT id FROM "LibraryModule" WHERE "key"='reporting'),
       'Exportación a Excel/PDF','Exportar tablas a Excel y reportes en PDF bajo demanda.','functional'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryRequirement" WHERE title='Exportación a Excel/PDF');

-- WORKFLOWS
INSERT INTO "LibraryRequirement" ("moduleId","title","body","type")
SELECT (SELECT id FROM "LibraryModule" WHERE "key"='workflows'),
       'Aprobaciones','Motor de aprobaciones multinivel configurable por reglas.','functional'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryRequirement" WHERE title='Aprobaciones');

-- MONITORING
INSERT INTO "LibraryRequirement" ("moduleId","title","body","type")
SELECT (SELECT id FROM "LibraryModule" WHERE "key"='monitoring'),
       'Alertas por umbral','Alertas por latencia/errores con canales Email/Slack.','nonfunctional'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryRequirement" WHERE title='Alertas por umbral');

-- SECURITY
INSERT INTO "LibraryRequirement" ("moduleId","title","body","type")
SELECT (SELECT id FROM "LibraryModule" WHERE "key"='security'),
       'Auditoría','Bitácora de auditoría por usuario/acción con retención 1 año.','nonfunctional'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryRequirement" WHERE title='Auditoría');
