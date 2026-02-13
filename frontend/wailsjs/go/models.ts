export namespace main {
	
	export class GlobalSettings {
	    timeout: number;
	    useProxy: boolean;
	    proxyHost: string;
	    proxyPort: number;
	    proxyUser: string;
	    proxyPassword: string;
	
	    static createFrom(source: any = {}) {
	        return new GlobalSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timeout = source["timeout"];
	        this.useProxy = source["useProxy"];
	        this.proxyHost = source["proxyHost"];
	        this.proxyPort = source["proxyPort"];
	        this.proxyUser = source["proxyUser"];
	        this.proxyPassword = source["proxyPassword"];
	    }
	}
	export class ServerInfo {
	    id: string;
	    name: string;
	    ip: string;
	    port: number;
	    user: string;
	    password: string;
	    privateKey: string;
	
	    static createFrom(source: any = {}) {
	        return new ServerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.ip = source["ip"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.privateKey = source["privateKey"];
	    }
	}

}

