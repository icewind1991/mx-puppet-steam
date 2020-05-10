import SteamId from "steamid";
import {EPersonaState, EChatEntryType, EChatRoomServerMessage} from "./enum";

export interface IIncomingFriendMessage {
	steamid_friend: SteamId,
	chat_entry_type: EChatEntryType,
	from_limited_account: boolean,
	message: string,
	message_no_bbcode: string,
	server_timestamp: Date,
	ordinal: number,
	local_echo: boolean,
	low_priority: boolean
	message_bbcode_parsed: BBCodeField[]
}

export type BBCodeField = BBCodeNode | string;

export function isBBCode(field: BBCodeField): field is BBCodeNode {
	return field['tag'] !== undefined;
}

export interface BBCodeNode {
	tag: string
	attrs: { [attr: string]: string },
	content: BBCodeField[]
}

export interface IIncomingChatMessage {
	chat_group_id: string,
	chat_id: string,
	chat_name: string,
	steamid_sender: SteamId,
	chat_entry_type?: EChatEntryType,
	from_limited_account?: boolean,
	message: string,
	message_no_bbcode: string,
	message_bbcode_parsed: BBCodeField[]
	server_timestamp: Date,
	ordinal: number,
	mentions: IChatMentions | null,
}

export interface IChatMentions {
	mention_all: boolean,
	mention_here,
	mention_steamids: SteamId[]
}

export interface IServerMessage {
	message: EChatRoomServerMessage,
	string_param?: string,
	steamid_param?: SteamId
}

// incomplete
export interface IPersona {
	persona_state: EPersonaState,
	player_name: string,
	avatar_hash: Buffer,
	last_logoff: Date,
	last_logon: Date,
	last_seen_online: Date,
	game_name: string,
	gameid: string,
	avatar_url_icon: string,
	avatar_url_medium: string,
	avatar_url_full: string
}

export interface AppInfo {
	changenumber: number,
	missingToken: boolean,
	appinfo: {
		appid: string,
		common: {
			name: string,
			type: string,
			releasestate: string,
			oslist: string,
			logo: string,
			logo_small: string,
			icon: string,
		},
		extended: {
			developer: string,
			publisher: string,
			homepage: string,
			listofdlc: string
		}
	}
}

export interface IGroupInfo {
	chat_group_id: string,
	default_chat_id: string,
	chat_rooms: {
		chat_id: string,
		chat_name: string,
	}[]
}
