# Modello di sicurezza

## PIN locale

Il PIN non viene memorizzato in chiaro. Ogni utente possiede un salt casuale e una derivazione PBKDF2-SHA-256. Dopo cinque errori consecutivi l'accesso viene bloccato temporaneamente.

Il PIN protegge l'interfaccia dell'applicazione, ma non cifra foto e video. Chi controlla completamente il dispositivo o il profilo del browser puo potenzialmente accedere ai dati locali. Il dispositivo deve quindi avere blocco schermo, cifratura di sistema e aggiornamenti di sicurezza attivi.

Le operazioni distruttive non si fidano soltanto della sessione in memoria: ruolo e stato dell'utente vengono riletti dentro la transazione IndexedDB che modifica i dati. Un amministratore disattivato o retrocesso da un'altra scheda non conserva quindi privilegi distruttivi. Le preferenze dei cantieri sono dati locali non autorizzativi e vengono separate tramite l'identificatore dell'utente e il contesto Caricamento/Archivio.

## Distribuzione

In produzione l'app deve essere pubblicata su HTTPS. Non disattivare la Content Security Policy presente in `index.html` e non aggiungere script remoti senza una revisione esplicita.

## Dati e backup

La release 1.3.0 conserva i dati su un solo dispositivo e non include sincronizzazione o backup completo. La cancellazione dei dati del sito, il ripristino del telefono o alcune politiche di storage del sistema possono rendere i file irrecuperabili.

Per media aziendali non sostituibili e necessario definire una procedura di backup verificata prima della distribuzione estesa. Una futura integrazione puo aggiungere esportazione cifrata o sincronizzazione opzionale senza modificare il modello offline-first.

## Segnalazione problemi

Prima di distribuire una modifica che riguarda autenticazione, permessi, cancellazioni, importazione o migrazioni IndexedDB, eseguire tutti i test e una prova su dispositivi Android e iPhone reali.
