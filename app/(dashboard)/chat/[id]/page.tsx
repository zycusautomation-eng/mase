// Shareable per-chat route: /chat/<id> renders the SAME chat workspace as /chat.
// The workspace reads the id from the URL and opens that conversation once the
// saved chats load (see ChatPageInner's open-from-URL effect). This is a thin
// re-export so both /chat and /chat/<id> mount the identical client component.
export { default } from "../page";
