const UTIL = require('./util');

let Discord;

async function doWhiteStar(discordRef, message, date = '', description = '') {
  Discord = discordRef;
  UTIL.logger('White Star Search', `${message.author.username} - Date: ${date}, Message: ${description}`);

  // send Q message
  // await message.channel.send(buildQMessageIntro(message, redStarLevel));
  const sendEmbed = message.channel.send(buildQMessage(message, date, message));
}

function buildQMessage(message, date, description) {
  return new Discord.MessageEmbed()
  .setTitle(`[Search] Red Star LVL}`)
  .setColor('#78D64B')
  .setAuthor('Owner: asd')
  .setDescription('')
  .setTimestamp()
  .setThumbnail('https://firebasestorage.googleapis.com/v0/b/personalpublic-ae1da.appspot.com/o/discord%2Ffemale-cheerleader.png?alt=media&token=a3f08000-5582-42d2-a56d-40451d086055')
  .setFooter('Curcubeu / CurcubeuAcademy')
  .addFields(
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '-',
      value: `-`,
      inline: true,
    },
    {
      name: '\u200B',
      value: `*Reacționează`,
      inline: false,
    },
  );
}

module.exports = { doWhiteStar };
