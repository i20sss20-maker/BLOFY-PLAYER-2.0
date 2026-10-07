using QRCoder;
using System.IO;
using System.Windows.Media.Imaging;

namespace BlofyPlayer.Windows.Core;

public static class QrCodeHelper
{
    public static BitmapImage Create(string text)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.Q);
        var qr = new PngByteQRCode(data);
        var bytes = qr.GetGraphic(7, new byte[] { 8, 6, 13 }, new byte[] { 255, 255, 255 }, true);

        var image = new BitmapImage();
        using var ms = new MemoryStream(bytes);
        image.BeginInit();
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.StreamSource = ms;
        image.EndInit();
        image.Freeze();
        return image;
    }
}
