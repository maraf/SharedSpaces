using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SharedSpaces.Server.Domain;

namespace SharedSpaces.Server.Infrastructure.Persistence.Configurations;

public class DeletedItemConfiguration : IEntityTypeConfiguration<DeletedItem>
{
    public void Configure(EntityTypeBuilder<DeletedItem> builder)
    {
        builder.ToTable("DeletedItems");

        builder.HasKey(d => d.ItemId);

        builder.Property(d => d.ItemId)
            .ValueGeneratedNever();

        builder.Property(d => d.DeletedAt)
            .IsRequired();

        builder.HasIndex(d => new { d.SpaceId, d.DeletedAt });

        builder.HasOne(d => d.Space)
            .WithMany(s => s.DeletedItems)
            .HasForeignKey(d => d.SpaceId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
