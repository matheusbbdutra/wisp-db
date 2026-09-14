export namespace db {
	
	export class QueryResult {
	    Columns: string[];
	    Types: string[];
	    Rows: any[][];
	
	    static createFrom(source: any = {}) {
	        return new QueryResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Columns = source["Columns"];
	        this.Types = source["Types"];
	        this.Rows = source["Rows"];
	    }
	}

}

