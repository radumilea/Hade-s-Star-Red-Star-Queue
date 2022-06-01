require("dotenv").config();
const Discord = require('discord.js')
const RS = require("./red-star");
const UTIL = require('./util');
const WS = require('./white-star');

const PREFIX = '!';

const client = new Discord.Client({
  partials: ['MESSAGE', 'REACTION']
});

client.on('ready', () => {
  UTIL.logger('Init', `${client.user.tag} has logged in.`);
});

client.on('message', async (message) => {
  // ignore messages made by bots
  if (message.author.bot) return;
  // validate prefix & extarct args
  if (message.content.startsWith(PREFIX)) {
    const [CMD_NAME, ...args] = message.content
      .trim()
      .substring(PREFIX.length)
      .split(/\s+/);
    if (CMD_NAME === 'curcubeu') {
      // check game mod
      if (args.length === 0) {
        UTIL.tipsMessage(message, `
Pentru a continua este necesar să alegi un tip de joc. Tipuri de joc diponibile: \`RS\` (Red Star)

**Red Star Search**
Pentru a anunța un RS este necesar să folosești comanda \`!curcubeu\` la care să adaugi tipul de joc (RS) și RS lvl-ul dorit (\`3,4,5,6,7,8,9,10 sau 11\`)

Comandă: \`!curcubeu RS <RS LVL>\`
Exemplu pentru Red Star lvl 3: \`!curcubeu RS 3\`
Exemplu pentru Red Star lvl 7: \`!curcubeu RS 7\`

Pentru quick search poți folosi una din comenzile: \`!rs3, !rs4, !rs5, ... !rs11\`. 
        `, 0);
        return;
      } else {
        const command = args[0].toUpperCase();
        console.log('command',command);
        if(command === 'RS') {
          // do red star
          if (args[1]) {
            const redStarLvl = parseInt(args[1]);
            // check if red star lvl is valid
            if (Number.isInteger(redStarLvl) && redStarLvl >= 3 && redStarLvl <= 12) {
              RS.doRedStar(Discord, message, redStarLvl, 'classic');
            } else {
              return RS.invalidRedStarLvl(message);
            }
          } else {
            return RS.invalidRedStarLvl(message);
          }
        } else if(command === 'RSD') {
          // do red star
          if (args[1]) {
            const redStarLvl = parseInt(args[1]);
            // check if red star lvl is valid
            if (Number.isInteger(redStarLvl) && redStarLvl >= 3 && redStarLvl <= 12) {
              RS.doRedStar(Discord, message, redStarLvl, 'dark');
            } else {
              return RS.invalidRedStarLvl(message);
            }
          } else {
            return RS.invalidRedStarLvl(message);
          }
        } else if (command === 'WS') {
          if (args[1]) {
            console.log("args[1]", args[1]);
          }
          if (args[2]) {
            console.log("args[2]", args[2]);
          }

          const date = args[1];
          const description = args[2];

          WS.doWhiteStar(Discord, message, date, description);
        } else {
          // display invalid mode
UTIL.tipsMessage(message, `
**Tipul de joc nu este corect!**
Tipuri de joc diponibile: \`RS\` (Red Star)

**Red Star Search**
Pentru a anunța un RS este necesar să folosești comanda \`!curcubeu\` la care să adaugi tipul de joc (\`RS\`) și RS lvl-ul dorit (\`3,4,5,6,7,8,9,10 sau 11\`)

Comandă: \`!curcubeu RS <RS LVL>\`
Exemplu pentru Red Star lvl 3: \`!curcubeu RS 3\`
Exemplu pentru Red Star lvl 7: \`!curcubeu RS 7\`

* *mesajul se autodistruge în 3 minute*
`, 3, true);
        }
      } 
    // DO Shortcuts for RS Quick Search
    } else if (CMD_NAME.length <= 5) {
      console.log('CMD_NAME', CMD_NAME);
      if (CMD_NAME.toUpperCase().includes('RSD')) {
        let rsLvl = CMD_NAME.toUpperCase().replace('RSD', '');
        rsLvl = parseInt(rsLvl);
        if (Number.isInteger(rsLvl) && rsLvl >= 3 && rsLvl <= 12) {
          console.log('do dark red star');
          RS.doRedStar(Discord, message, rsLvl, 'dark');
        } 
      } else if (CMD_NAME.toUpperCase().includes('RS')) {
        let rsLvl = CMD_NAME.toUpperCase().replace('RS', '');
        rsLvl = parseInt(rsLvl);
        if (Number.isInteger(rsLvl) && rsLvl >= 3 && rsLvl <= 12) {
          RS.doRedStar(Discord, message, rsLvl, 'classic');
        } 
      }
    }
  }
});

client.login(process.env.DISCORDJS_BOT_TOKEN);
