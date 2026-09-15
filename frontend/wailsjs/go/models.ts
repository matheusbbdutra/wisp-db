export namespace db {
	
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
	export class Table {
	    Schema: string;
	    Name: string;
	    Columns: Column[];
	
	    static createFrom(source: any = {}) {
	        return new Table(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Schema = source["Schema"];
	        this.Name = source["Name"];
	        this.Columns = this.convertValues(source["Columns"], Column);
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

export namespace main {
	
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

