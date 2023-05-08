import { createTicket } from '@app/common/create-ticket';
import { DiscordSelectMenu } from '@app/models/discord-select-menu';
import { StringSelectMenuInteraction } from 'discord.js';
import { Discord, SelectMenuComponent } from 'discordx';

@Discord()
export class CreateATicketCategorySelectMenu extends DiscordSelectMenu {
    service = 'create-a-ticket-category';

    @SelectMenuComponent({
        id: 'create-a-ticket-category',
    })
    async createATicketCategory(interaction: StringSelectMenuInteraction) {
        // If this is not in a guild and channel, ignore it
        if (!interaction.guild) return;
        if (!interaction.channel) return;

        // Show the bot is thinking
        await interaction.deferUpdate();

        // Get the category ID from the button's custom ID
        const categoryId = interaction.values[0];
        if (!categoryId) throw new Error('Invalid category ID');

        // Let the user know their ticket is being created
        await interaction.editReply({
            content: 'https://media.tenor.com/Z8SwGzcIitEAAAAC/just-give-me-a-minute-hang-on.gif',
            components: [],
        });

        // Create the ticket
        const ticketChannel = await createTicket(interaction.guild, interaction.user, categoryId);

        // Send the ticket created message
        await interaction.editReply({
            content: `Your ticket has been created: <#${ticketChannel.id}>`,
            components: [],
        });
    }
}
