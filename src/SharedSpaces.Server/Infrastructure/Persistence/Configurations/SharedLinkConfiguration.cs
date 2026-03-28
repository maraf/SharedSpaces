using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SharedSpaces.Server.Domain;

namespace SharedSpaces.Server.Infrastructure.Persistence.Configurations;

public class SharedLinkConfiguration : IEntityTypeConfiguration<SharedLink>
{
    public void Configure(EntityTypeBuilder<SharedLink> builder)
    {
        builder.ToTable("SharedLinks");

        builder.HasKey(link => link.Id);

        builder.Property(link => link.Id)
            .ValueGeneratedNever();

        builder.Property(link => link.Token)
            .IsRequired();

        builder.HasIndex(link => link.Token)
            .IsUnique();

        builder.HasIndex(link => new { link.SpaceId, link.ItemId });

        builder.HasOne(link => link.Space)
            .WithMany()
            .HasForeignKey(link => link.SpaceId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(link => link.Item)
            .WithMany()
            .HasForeignKey(link => link.ItemId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(link => link.Creator)
            .WithMany()
            .HasForeignKey(link => link.CreatedBy)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
