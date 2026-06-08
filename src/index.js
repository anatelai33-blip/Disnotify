import { Client, GatewayIntentBits, Events, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import logger from './logger/winston.js';

dotenv.config();

const prisma = new PrismaClient();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

const rateLimitMap = new Map();

function isRateLimited(adminId) {
  const now = Date.now();
  const windowStart = now - 60000;
  
  if (!rateLimitMap.has(adminId)) {
    rateLimitMap.set(adminId, [now]);
    return false;
  }
  
  const timestamps = rateLimitMap.get(adminId).filter(t => t > windowStart);
  
  if (timestamps.length >= 10) {
    return true;
  }
  
  timestamps.push(now);
  rateLimitMap.set(adminId, timestamps);
  return false;
}

async function sendJoinNotification(member, serverName) {
  const adminIds = process.env.ADMIN_USER_IDS.split(',').map(id => id.trim());
  
  const embed = new EmbedBuilder()
    .setColor(0x2B2D42)
    .setTitle('🔔 New Member Joined')
    .setDescription(`**${member.user.username}** has joined **${serverName}**`)
    .addFields(
      { name: 'User ID', value: member.user.id, inline: true },
      { name: 'Server Member Count', value: `${member.guild.memberCount}`, inline: true },
      { name: 'Joined At', value: new Date().toLocaleString(), inline: false }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp()
    .setFooter({ text: 'Disnotify Pro • Real-time Monitoring' });

  let successCount = 0;
  
  for (const adminId of adminIds) {
    if (isRateLimited(adminId)) {
      logger.warn(`Rate limit hit for admin ${adminId}`);
      continue;
    }
    
    try {
      const admin = await client.users.fetch(adminId);
      if (admin) {
        await admin.send({ embeds: [embed] });
        logger.info(`DM sent to admin ${adminId} for ${member.user.username}`);
        successCount++;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      if (error.code === 50007) {
        logger.warn(`Cannot DM admin ${adminId} — DMs closed`);
      } else {
        logger.error(`Failed to DM admin ${adminId}: ${error.message}`);
      }
    }
  }
  
  try {
    await prisma.joinEvent.create({
      data: {
        userId: member.user.id,
        username: member.user.username,
        serverId: member.guild.id,
        serverName: serverName,
        notified: successCount > 0
      }
    });
    logger.info(`Join event logged for ${member.user.username}`);
  } catch (dbError) {
    logger.error(`Failed to log join event: ${dbError.message}`);
  }
  
  return successCount;
}

client.once(Events.ClientReady, async () => {
  logger.info(`✅ Logged in as ${client.user.tag}`);
  logger.info(`Monitoring ${client.guilds.cache.size} server(s)`);
  logger.info(`Notifying ${process.env.ADMIN_USER_IDS.split(',').length} admin(s)`);
  await prisma.$connect();
  logger.info('Database connected');
});

client.on(Events.GuildMemberAdd, async (member) => {
  const serverName = member.guild.name;
  logger.info(`New member: ${member.user.username} joined ${serverName}`);
  
  try {
    const dmCount = await sendJoinNotification(member, serverName);
    logger.info(`Notification sent to ${dmCount} admin(s)`);
  } catch (error) {
    logger.error(`Error handling member join: ${error.message}`);
  }
});

client.on(Events.Error, (error) => {
  logger.error(`Discord client error: ${error.message}`);
});

process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  await prisma.$disconnect();
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  logger.error(`Unhandled rejection: ${error.message}`);
});

client.login(process.env.DISCORD_TOKEN);
