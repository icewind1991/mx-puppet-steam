import {
	PuppetBridge,
	IProtocolInformation,
	IPuppetBridgeRegOpts,
	Log,
	IRetData,
} from "mx-puppet-bridge";
import * as commandLineArgs from "command-line-args";
import * as commandLineUsage from "command-line-usage";
import {Steam} from "./steam";
import {NextcloudConfigWrap} from "./config";
import * as fs from "fs";
import * as yaml from "js-yaml";
import {LoginDetails, LoginToken} from "./login";
import * as SteamUser from "steam-user";

const log = new Log("NextcloudPuppet:index");

const commandOptions = [
	{name: "register", alias: "r", type: Boolean},
	{name: "registration-file", alias: "f", type: String},
	{name: "config", alias: "c", type: String},
	{name: "help", alias: "h", type: Boolean},
];
const options = Object.assign({
	"register": false,
	"registration-file": "steam-registration.yaml",
	"config": "config.yaml",
	"help": false,
}, commandLineArgs(commandOptions));

if (options.help) {
	// tslint:disable-next-line:no-console
	console.log(commandLineUsage([
		{
			header: "Matrix Stream Puppet Bridge",
			content: "A matrix puppet bridge for steam",
		},
		{
			header: "Options",
			optionList: commandOptions,
		},
	]));
	process.exit(0);
}

const protocol = {
	features: {typingTimeout : 1000, presence: true, image: true},
	id: "steam",
	displayname: "Steam",
	externalUrl: "https://steamcommunity.com/",
} as IProtocolInformation;

const puppet = new PuppetBridge(options["registration-file"], options.config, protocol);

if (options.register) {
	// okay, all we have to do is generate a registration file
	puppet.readConfig(false);
	try {
		puppet.generateRegistration({
			prefix: "_steampuppet_",
			id: "steam-puppet",
			url: `http://${puppet.Config.bridge.bindAddress}:${puppet.Config.bridge.port}`,
		} as IPuppetBridgeRegOpts);
	} catch (err) {
		// tslint:disable-next-line:no-console
		console.log("Couldn't generate registration file:", err);
	}
	process.exit(0);
}

let config: NextcloudConfigWrap = new NextcloudConfigWrap();

function readConfig() {
	config = new NextcloudConfigWrap();
	config.applyConfig(yaml.safeLoad(fs.readFileSync(options.config)));
}

export function Config(): NextcloudConfigWrap {
	return config;
}

async function run() {
	await puppet.init();
	// readConfig();
	const steam = new Steam(puppet);
	puppet.on("puppetNew", steam.newPuppet.bind(steam));
	puppet.on("puppetDelete", steam.deletePuppet.bind(steam));
	puppet.on("message", steam.handleMatrixMessage.bind(steam));
	puppet.on("image", steam.handleMatrixImage.bind(steam));
	puppet.setCreateUserHook(steam.createUser.bind(steam));
	// puppet.setGetUserIdsInRoomHook(steam.getUserIdsInRoom.bind(steam));
	puppet.setListUsersHook(steam.listUsers.bind(steam));
	puppet.setGetDmRoomIdHook(steam.getDmRoomId.bind(steam));
	puppet.setCreateRoomHook(steam.createRoom.bind(steam));
	puppet.setGetDescHook(async (puppetId: number, data: any): Promise<string> => {
		let s = "Steam";
		if (data.screenName) {
			s += ` as ${data.screenName}`;
		}
		if (data.name) {
			s += ` (${data.name})`;
		}
		return s;
	});
	puppet.setGetDataFromStrHook(async (str: string): Promise<IRetData> => {
		if (!str) {
			return {
				success: false,
				error: `Usage: link <username> <password>`
			};
		}

		let [username, password] = str.split(" ", 2);

		const client = new SteamUser();

		let details: LoginDetails = {
			accountName: username,
			password,
			rememberPassword: true,
		};

		return new Promise(resolve => {
			let successResolve = resolve;

			client.on("loginKey", function(loginKey) {

				successResolve({
					success: true,
					data: {
						accountName: username,
						loginKey
					}
				});
			});


			client.on("steamGuard", function(domain, cb) {
				resolve({
					success: false,
					error: `Please provide steam guard code`,
					fn: async (code) => {
						cb(code);

						return new Promise(resolve => {
							successResolve = resolve;
						})
					}
				});
			});

			client.on("error", (err) => {
				resolve({
					success: false,
					error: err.message
				});
			});

			client.logOn(details);
		});

	});
	await puppet.start();
}

// tslint:disable-next-line:no-floating-promises
run(); // start the thing!
