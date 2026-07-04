CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    careersUrl TEXT,
    discoveryMethod TEXT,
    discoveryStatus TEXT DEFAULT 'pending',
    category TEXT CHECK(category IN ('ats', 'xhr', 'dom')),

    atsPlatform TEXT,
    atsSlug TEXT,

    xhrEndpoint TEXT,
    xhrHeaders TEXT,
    xhrParams TEXT,

    selectorTitle TEXT,
    selectorLocation TEXT,
    selectorLink TEXT,
    requiresJs INTEGER DEFAULT 0,

    lastDiscoveryDate TEXT,
    lastRunDate TEXT,
    consecutiveZeroDays INTEGER DEFAULT 0,
    flaggedForRediscovery INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId INTEGER NOT NULL,
    jobId TEXT NOT NULL,
    title TEXT,
    location TEXT,
    url TEXT,
    description TEXT,
    techStackTags TEXT,
    dateFirstSeen TEXT,
    dateLastSeen TEXT,
    isActive INTEGER DEFAULT 1,
    status TEXT DEFAULT 'new',
    UNIQUE(companyId, jobId),
    FOREIGN KEY(companyId) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS daily_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId INTEGER NOT NULL,
    snapshotDate TEXT NOT NULL,
    jobIds TEXT NOT NULL,
    FOREIGN KEY(companyId) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS stack_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL UNIQUE,
    enabled INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS location_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal TEXT NOT NULL UNIQUE,
    bucket TEXT NOT NULL CHECK(bucket IN ('us', 'international')),
    enabled INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL
);
