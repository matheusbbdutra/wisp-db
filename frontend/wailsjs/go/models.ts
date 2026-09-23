export namespace db {

	export class BatchOp {
	    Kind: string;
	    Schema: string;
	    Table: string;
	    Columns: string[];
	    Values: any[];
	    PKColumns: string[];
	    PKValues: any[];

	    static createFrom(source: any = {}) {
	        return new BatchOp(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Kind = source["Kind"];
	        this.Schema = source["Schema"];
	        this.Table = source["Table"];
	        this.Columns = source["Columns"];
	        this.Values = source["Values"];
	        this.PKColumns = source["PKColumns"];
	        this.PKValues = source["PKValues"];
	    }
	}
	export class Column {
	    Name: string;
	    Type: string;
	    IsPrimaryKey: boolean;
	    IsGenerated: boolean;
	    Nullable: boolean;

	    static createFrom(source: any = {}) {
	        return new Column(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Type = source["Type"];
	        this.IsPrimaryKey = source["IsPrimaryKey"];
	        this.IsGenerated = source["IsGenerated"];
	        this.Nullable = source["Nullable"];
	    }
	}
	export class ForeignKey {
	    Name: string;
	    Columns: string[];
	    RefSchema: string;
	    RefTable: string;
	    RefColumns: string[];
	    Definition: string;

	    static createFrom(source: any = {}) {
	        return new ForeignKey(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Columns = source["Columns"];
	        this.RefSchema = source["RefSchema"];
	        this.RefTable = source["RefTable"];
	        this.RefColumns = source["RefColumns"];
	        this.Definition = source["Definition"];
	    }
	}
	export class Function {
	    Name: string;
	    Definition: string;

	    static createFrom(source: any = {}) {
	        return new Function(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Definition = source["Definition"];
	    }
	}
	export class IncomingForeignKey {
	    Name: string;
	    FromSchema: string;
	    FromTable: string;
	    FromColumns: string[];
	    ToColumns: string[];
	    OnDelete: string;

	    static createFrom(source: any = {}) {
	        return new IncomingForeignKey(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.FromSchema = source["FromSchema"];
	        this.FromTable = source["FromTable"];
	        this.FromColumns = source["FromColumns"];
	        this.ToColumns = source["ToColumns"];
	        this.OnDelete = source["OnDelete"];
	    }
	}
	export class Index {
	    Name: string;
	    Columns: string[];
	    Unique: boolean;
	    Definition: string;

	    static createFrom(source: any = {}) {
	        return new Index(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Columns = source["Columns"];
	        this.Unique = source["Unique"];
	        this.Definition = source["Definition"];
	    }
	}
	export class Sequence {
	    Name: string;
	    DataType: string;
	    StartValue: number;
	    Increment: number;

	    static createFrom(source: any = {}) {
	        return new Sequence(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.DataType = source["DataType"];
	        this.StartValue = source["StartValue"];
	        this.Increment = source["Increment"];
	    }
	}
	export class Table {
	    Schema: string;
	    Name: string;
	    Columns: Column[];
	    Kind: string;

	    static createFrom(source: any = {}) {
	        return new Table(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Schema = source["Schema"];
	        this.Name = source["Name"];
	        this.Columns = this.convertValues(source["Columns"], Column);
	        this.Kind = source["Kind"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SchemaObjects {
	    tables: Table[];
	    views: Table[];
	    functions: Function[];
	    sequences: Sequence[];

	    static createFrom(source: any = {}) {
	        return new SchemaObjects(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tables = this.convertValues(source["tables"], Table);
	        this.views = this.convertValues(source["views"], Table);
	        this.functions = this.convertValues(source["functions"], Function);
	        this.sequences = this.convertValues(source["sequences"], Sequence);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}


	export class Trigger {
	    Name: string;
	    Definition: string;

	    static createFrom(source: any = {}) {
	        return new Trigger(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Definition = source["Definition"];
	    }
	}

}

export namespace main {

	export class ExportOptions {
	    tabId: string;
	    query?: string;
	    schema?: string;
	    table?: string;
	    filePath: string;
	    format: string;
	    batchSize?: number;

	    static createFrom(source: any = {}) {
	        return new ExportOptions(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tabId = source["tabId"];
	        this.query = source["query"];
	        this.schema = source["schema"];
	        this.table = source["table"];
	        this.filePath = source["filePath"];
	        this.format = source["format"];
	        this.batchSize = source["batchSize"];
	    }
	}
	export class ExportResult {
	    totalRows: number;
	    durationMs: number;
	    fileSizeBytes: number;

	    static createFrom(source: any = {}) {
	        return new ExportResult(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.totalRows = source["totalRows"];
	        this.durationMs = source["durationMs"];
	        this.fileSizeBytes = source["fileSizeBytes"];
	    }
	}
	export class FetchBatch {
	    Rows: any[][];
	    HasMore: boolean;

	    static createFrom(source: any = {}) {
	        return new FetchBatch(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Rows = source["Rows"];
	        this.HasMore = source["HasMore"];
	    }
	}
	export class HistoryPage {
	    entries: store.QueryHistoryEntry[];
	    totalCount: number;

	    static createFrom(source: any = {}) {
	        return new HistoryPage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], store.QueryHistoryEntry);
	        this.totalCount = source["totalCount"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class QueryMetadata {
	    Columns: string[];
	    Types: string[];
	    DurationMs: number;

	    static createFrom(source: any = {}) {
	        return new QueryMetadata(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Columns = source["Columns"];
	        this.Types = source["Types"];
	        this.DurationMs = source["DurationMs"];
	    }
	}
	export class SessionMetadata {
	    tabId: string;
	    driver: string;
	    dialect: string;
	    serverVersion: string;

	    static createFrom(source: any = {}) {
	        return new SessionMetadata(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tabId = source["tabId"];
	        this.driver = source["driver"];
	        this.dialect = source["dialect"];
	        this.serverVersion = source["serverVersion"];
	    }
	}
	export class UpdateInfo {
	    CurrentVersion: string;
	    LatestVersion: string;
	    HTMLURL: string;
	    HasUpdate: boolean;

	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.CurrentVersion = source["CurrentVersion"];
	        this.LatestVersion = source["LatestVersion"];
	        this.HTMLURL = source["HTMLURL"];
	        this.HasUpdate = source["HasUpdate"];
	    }
	}

}

export namespace sshtunnel {

	export class SSHConfig {
	    enabled: boolean;
	    host: string;
	    port: number;
	    user: string;
	    authMethod: string;
	    password?: string;
	    keyPath?: string;
	    keyPassphrase?: string;

	    static createFrom(source: any = {}) {
	        return new SSHConfig(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.authMethod = source["authMethod"];
	        this.password = source["password"];
	        this.keyPath = source["keyPath"];
	        this.keyPassphrase = source["keyPassphrase"];
	    }
	}

}

export namespace store {

	export class QueryHistoryEntry {
	    ID: number;
	    ConnectionID: string;
	    TabID: string;
	    QueryText: string;
	    Status: string;
	    DurationMs: number;
	    RowCount: number;
	    // Go type: time
	    ExecutedAt: any;

	    static createFrom(source: any = {}) {
	        return new QueryHistoryEntry(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.ConnectionID = source["ConnectionID"];
	        this.TabID = source["TabID"];
	        this.QueryText = source["QueryText"];
	        this.Status = source["Status"];
	        this.DurationMs = source["DurationMs"];
	        this.RowCount = source["RowCount"];
	        this.ExecutedAt = this.convertValues(source["ExecutedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SavedConnection {
	    ID: string;
	    Name: string;
	    Driver: string;
	    // Go type: time
	    CreatedAt: any;

	    static createFrom(source: any = {}) {
	        return new SavedConnection(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Name = source["Name"];
	        this.Driver = source["Driver"];
	        this.CreatedAt = this.convertValues(source["CreatedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SavedConnectionEdit {
	    driver: string;
	    dsn: string;
	    ssh?: sshtunnel.SSHConfig;

	    static createFrom(source: any = {}) {
	        return new SavedConnectionEdit(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.driver = source["driver"];
	        this.dsn = source["dsn"];
	        this.ssh = this.convertValues(source["ssh"], sshtunnel.SSHConfig);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SavedScript {
	    ID: string;
	    Name: string;
	    QueryText: string;
	    // Go type: time
	    CreatedAt: any;
	    // Go type: time
	    UpdatedAt: any;

	    static createFrom(source: any = {}) {
	        return new SavedScript(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Name = source["Name"];
	        this.QueryText = source["QueryText"];
	        this.CreatedAt = this.convertValues(source["CreatedAt"], null);
	        this.UpdatedAt = this.convertValues(source["UpdatedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

