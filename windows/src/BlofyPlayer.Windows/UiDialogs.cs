using System.Windows;
using System.Windows.Controls;

namespace BlofyPlayer.Windows;

public static class UiDialogs
{
    public static string? Prompt(Window owner, string title, string label, bool password = false, string initial = "")
    {
        var window = new Window
        {
            Owner = owner,
            Title = title,
            Width = 390,
            Height = 210,
            ResizeMode = ResizeMode.NoResize,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Background = System.Windows.Media.Brushes.White,
            FlowDirection = FlowDirection.RightToLeft,
            ShowInTaskbar = false
        };

        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = label,
            Margin = new Thickness(0, 0, 0, 10),
            FontSize = 14,
            Foreground = System.Windows.Media.Brushes.Black
        });

        Control input;
        if (password)
        {
            input = new PasswordBox { Password = initial, Height = 36, FlowDirection = FlowDirection.LeftToRight };
        }
        else
        {
            input = new TextBox { Text = initial, Height = 36 };
        }
        root.Children.Add(input);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Left,
            Margin = new Thickness(0, 18, 0, 0)
        };
        var ok = new Button { Content = "موافق", Width = 95, Height = 34, Margin = new Thickness(8, 0, 0, 0) };
        var cancel = new Button { Content = "إلغاء", Width = 95, Height = 34 };
        actions.Children.Add(ok);
        actions.Children.Add(cancel);
        root.Children.Add(actions);

        ok.Click += (_, _) => window.DialogResult = true;
        cancel.Click += (_, _) => window.DialogResult = false;
        window.Content = root;
        window.Loaded += (_, _) => input.Focus();

        if (window.ShowDialog() != true) return null;
        return input is PasswordBox pb ? pb.Password : ((TextBox)input).Text;
    }

    public static bool Confirm(Window owner, string title, string message) =>
        MessageBox.Show(owner, message, title, MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;
}
